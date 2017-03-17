"use strict";

var User = require('../user/user_model.js');
var FitbitStrategy = require('passport-fitbit-oauth2').FitbitOAuth2Strategy
var FitbitApiClient = require('fitbit-node');
var jwt = require('jsonwebtoken');
var Q = require("q");
var utils = require('./fitbit_utility.js').util;
var fitIds = require('./fitbit_activity_ids.js');
var path = require('path');

// For processing Fitbit's push notification in the format of multipart/form (not bodyparsed :\)
var multiparty = require('multiparty');
var format = require('util').format;

var mongoose = require('mongoose');
mongoose.Promise = require('q').Promise;
var FITBIT_CONSUMER_KEY = process.env.FITBIT_CONSUMER_KEY;
var FITBIT_CONSUMER_SECRET = process.env.FITBIT_CONSUMER_SECRET;

var host = process.env.HOST || 'https://localhost:9000';

var myClient = new FitbitApiClient(FITBIT_CONSUMER_KEY, FITBIT_CONSUMER_SECRET);

var userId;

module.exports = exports = {
    fitbitStrategy: new FitbitStrategy({
            clientID: FITBIT_CONSUMER_KEY,
            clientSecret: FITBIT_CONSUMER_SECRET,
            callbackURL: host + '/fitbit/authcallback',
            scope: ['activity', 'heartrate', 'location', 'nutrition', 'profile', 'settings', 'sleep', 'social', 'weight']
        },
        function(accessToken, refreshToken, profile, done) {
            var timestamp = new Date();
            userId = profile.id;

            process.nextTick(function() {
                var promise = User.findById({_id: userId}).exec();
                promise.then(function(foundUser) {
                    if (foundUser) {
                        done(null, foundUser);
                    } else {
                        var currentUser = new User({
                            _id: userId,
                            createdAt: timestamp,
                            accessToken: accessToken, //chance add to fix undefined errors
                            refreshToken: refreshToken //chance add to fix undefined errors
                        });
                        done(null, currentUser);
                        exports.subscribeUser(accessToken, refreshToken, userId);
                        return saveInPromise(currentUser);
                    }
                }).then(function() {
                    // re-logging in changes the token and secret, so in any case we must update it
                    // the second parameter is null because it expects a potential callback
                    return exports.getAllData(userId, null, accessToken, refreshToken);
                }).fail(function(err) {}).done();
            });
        }),

    sendBrokenResponse: function(req, res, next) {
        console.log('gets to the broken response');
        res.sendStatus(200);
    },

    refreshAccessToken: function(req, res){
        console.log("refreshAccessToken() start");
        var userId = req.body.userId;
        console.log("userId: " + userId);
        var accessToken = req.body.accessToken;
        console.log("accessToken: " + accessToken);
        var refreshToken = req.body.refreshToken;
        console.log("refreshToken: " + refreshToken);
        var expiresInSeconds = 3600;
        var client = new FitbitApiClient(FITBIT_CONSUMER_KEY, FITBIT_CONSUMER_SECRET);
        
        var promise = User.findById({_id: id}).exec();
        promise.then(function(user) {
            client.refreshAccessToken(accessToken, refreshToken, expiresInSeconds).then(function(result) {
                //save access token and refresh token for user
                //result.access_token & result.refresh_token
                console.log("client.refreshAccessToken()");
                user.accessToken = result.access_token;
                console.log("new accessToken: " + user.accessToken);
                user.refreshToken = result.refresh_token;
                console.log("new refreshToken: " + user.refreshToken);
            })
        .then(function(user){
            console.log("save user object");
            saveInPromise(user);
        })    
        .done(function(){
            console.log("refreshAccessToken() end");
        });
    },

    getOauthToken: function(req, res, next) {
        var userToken = req.query['oauth_token']; //remember the user should save this, db needs do nothing with it

        var server_token = jwt.sign({
                id: userId
            },
            process.env.SECRET || "secret", {
                //expiresIn: "7d"
                expiresIn: "1h" //1 hour to test refreshTokens
            }
        );
        res.redirect('?oauth_token=' + server_token + '&userId=' + userId); //this should never be viewed by the user, just ending the res, change to res.end later
    },

    subscribeUser: function(fitbitAccessToken, fitbitRefreshToken, id) { //subscribe this user so we get push notifications
        var client = new FitbitApiClient(FITBIT_CONSUMER_KEY, FITBIT_CONSUMER_SECRET);
        client.post('/apiSubscriptions/' + id + '.json', fitbitAccessToken);
    },

    //chance try refresh start 11/3 - this works -> send refresh token back or call another function that sends back new access token
    validateUserToken: function(req, res) { //subscribe this user so we get push notifications
        var accessTokenMatches = false;
        //find the user in the DB
        var fitbitAccessToken = req.body.fitbitAccessToken;
        var userId = req.body.userId;

        var promise = User.findById({
            _id: userId
        }).exec();
        promise.then(function(foundUser) {
                if (foundUser) {
                    //if the accessToken for the found user equals the accessToken passed
                    if (foundUser.accessToken === fitbitAccessToken) {
                        accessTokenMatches = true;
                    }
                }
                //return accessTokenMatches;
                res.send("" + accessTokenMatches);
            })
            .fail(function(err) {
                console.log(err);
            })
            .done();
    },
    //chance try refresh end 11/3

    pushNotification: function(req, res, next) {

        var users = req.body;
        for (var j = 0; j < users.length; j++) {
            (function(i) {

                var promise = User.findById({
                    _id: users[i].ownerId
                }).exec();
                promise.then(function(user) {
                        user.needsUpdate = true;
                        return user;
                    })
                    .then(function(user) {
                        return saveInPromise(user);
                    })
                    .fail(function(err) {
                        console.log(err);
                    })
                    .done();
            }(j));
        }

        res.set('Content-Type', 'application/json');
        res.sendStatus(204);
    },

    // typically, this window should never be seen and just automatically closed,
    // but in the cases where the closing window doesn't work, this provides a manual way to do itd
    finishLogin: function(req, res, next) {
        if (req.query['oauth_token'] && req.query['userId']) {
            res.sendFile(path.resolve('./static/loggedIn.html'));
        } else {
            next();
        }
    },

    retrieveData: function(req, res, next) {
        var id = req.params.id;
        exports.getAllData(id);
        res.sendStatus(200);
    },

    getAllData: function(id, cb, accessToken, refreshToken) {
        var client = new FitbitApiClient(FITBIT_CONSUMER_KEY, FITBIT_CONSUMER_SECRET);
        var dateCreated;

        var promise = User.findById({_id: id}).exec();

        promise.then(function(user) {
          if (accessToken && refreshToken) {
            user.accessToken = accessToken;
            user.refreshToken = refreshToken;
          }
          dateCreated = user.createdAt.subtractDays(1).yyyymmdd(); // to make up for time zone mixing up, this is a buffer
          user.lastActive = user.lastActive || new Date(); //if new date this means they are a first time user

          /* START GET TIME ASLEEP FROM LAST CHECK AND USE IT TO CALC SLEEP HP RECOVERY, THIS NUMBER ONLY USED ONCE */
          var HPChecker = user.HPChecker;
          var today = (new Date()).yyyymmdd();
          var dateLastChecked = HPChecker.dateLastChecked || user.createdAt;
          var hpLastChecked = dateLastChecked.yyyymmdd();
          // if we didn't check yet before today, we reset foundSleep to false
          if (hpLastChecked !== today) {
            HPChecker.foundSleep = false;
          }

          user.HPChecker.dateLastChecked = new Date(); //set the new lastchecked date to today
          var hpURL = '/sleep/minutesAsleep/date/' + hpLastChecked + '/today.json';
          /* END GET TIME ASLEEP FROM LAST CHECK AND USE IT TO CALC SLEEP HP RECOVERY, THIS NUMBER ONLY USED ONCE */

          /* START GET WORKOUTS AND CALCULATE THEM TO BE DEXTERITY/STRENGTH */
          var lastChecked = user.stringLastChecked || user.createdAt.subtractDays(1);
          var yesterday = (new Date()).subtractDays(1);
          var datesArr = getDatesArray(new Date(lastChecked), yesterday);
          /* END GET WORKOUTS AND CALCULATE THEM TO BE DEXTERITY/STRENGTH */

          var promiseArray = [];
          promiseArray.push(client.get('/profile.json', user.accessToken));
          promiseArray.push(client.get('/friends.json', user.accessToken));
          promiseArray.push(client.get('/activities/tracker/steps/date/' + dateCreated + '/today.json', user.accessToken));
          promiseArray.push(client.get('/sleep/minutesAsleep/date/' + dateCreated + '/today.json', user.accessToken));
          promiseArray.push(client.get('/activities/tracker/distance/date/' + dateCreated + '/today.json', user.accessToken));
          promiseArray.push(client.get('/activities/minutesVeryActive/date/' + dateCreated + '/today.json', user.accessToken));

          // if it's true and the dates do match then we don't do anything bc we've found sleep today
          var trueAndDatesMatch = hpLastChecked === today || HPChecker.foundSleep === true;
          if (!trueAndDatesMatch) {
            promiseArray.push(client.get(hpURL, user.accessToken));
          }

          var yesterdayEqualsLastChecked = yesterday.yyyymmdd() === lastChecked;
          if (!yesterdayEqualsLastChecked) {
            var num = datesArr.length - 7 > 0 ? datesArr.length - 7 : 0; //only check the last 7 days
            user.stringLastChecked = datesArr[datesArr.length - 1]; //this importantly sets our last checked variable
            for (var i = datesArr.length - 1; i >= num; i--) {
              promiseArray.push(client.get('/activities/date/' + datesArr[i] + '.json', user.accessToken));
            }
          }

          return Q.all(promiseArray)
          .then(function(results) {
            console.log(results);
          });
                
            })
            .then(function(user) {
                return saveInPromise(user);
            })
            .fail(function(err) {
                console.log("Chance need to refresh token");
                console.log(err);
                //TODO chance refresh token stuff
            })
            .done();
    },

    getActivitiesDateRange: function(req, res, next) {
        var client = myClient;
        var id = req.params.id;
        var type = req.params.type; //will be 'sleep' or 'activities'
        var activity = req.params.activity;
        var startDate = req.params.startDate;
        var endDate = req.params.endDate;
        var qString = 'activities-' + activity;
        var url = '/activities/' + activity + '/date/' + startDate + '/' + endDate + '.json'; // this was /steps/steps/date/2016-10-21/2016-10-21.json
        //console.log(url); // "/activities/steps/date/2016-11-13/2016-11-13.json"

        var promise = User.findById({
            _id: id
        }).exec();

        promise.then(function(user) {
          return client.get(url, user.accessToken).then(function(results) {
            if (activity === 'distance') {
              //console.log(JSON.stringify(results[0]));//looks like {"activities-steps":[{"dateTime":"2016-10-21","value":"9256"}]}
              var total = utils.calcDecValue(results[0][qString]); //issue is here, qString was distance-distance
              res.json({
                total: total
              });
            } else {
              //console.log(JSON.stringify(results[0])); //looks like {"activities-distance":[{"dateTime":"2016-10-21","value":"7.025399999999999"}]}
              var total = utils.calcCumValue(results[0][qString]);
              res.json({
                total: total
              });
            }
          });
        })
        .fail(function(err) {
          console.log(err);
        })
        .done();
    },

    // Possible activities are calories, steps, distance, elevation, floors
    getActivitiesTimeRange: function(req, res, next) {
        var client = myClient;
        var id = req.params.id;
        var activity = req.params.activity;
        var startDate = req.params.startDate;
        var endDate = req.params.endDate;
        var startTime = req.params.startTime;
        var endTime = req.params.endTime;
        var qString = 'activities-' + activity;
        var url = '/activities/' + activity + '/date/' + startDate + '/1d/15min/time/' + startTime + '/' + endTime + '.json';

        var promise = User.findById({
            _id: id
        }).exec();
        promise.then(function(user) {
                return client.get(url, user.accessToken).then(function(results) {

                    if (activity === 'distance') { //decimals!
                        var total = (results[0][qString][0].value * 0.62137).toFixed(2); //convert to miles
                        res.json({
                            total: total
                        });
                    } else {
                        var total = results[0][qString][0].value;
                        res.json({
                            total: total
                        });
                    }
                });
            })
            .fail(function(err) {
                console.log(err);
            })
            .done();
    }
};

// Reformatting of dates to fit Fitbit preferred date format in API calls
Date.prototype.yyyymmdd = function() {
    var yyyy = this.getFullYear().toString();
    var mm = (this.getMonth() + 1).toString(); // getMonth() is zero-based
    var dd = this.getDate().toString();
    return yyyy + '-' + (mm[1] ? mm : "0" + mm[0]) + '-' + (dd[1] ? dd : "0" + dd[0]);
};

Date.prototype.addDays = function(days) {
    var dat = new Date(this.valueOf());
    dat.setDate(dat.getDate() + days);
    return dat;
};

Date.prototype.subtractDays = function(days) {
    var dat = new Date(this.valueOf());
    dat.setDate(dat.getDate() - days);
    return dat;
};

var getDatesArray = function(startDate, stopDate) {
    var dateArray = [];
    var currentDate = startDate.addDays(1);
    while (currentDate <= stopDate) {
        var fitbitCurDate = currentDate.yyyymmdd();
        dateArray.push(fitbitCurDate);
        currentDate = currentDate.addDays(1);
    }
    return dateArray;
};

//Utility function to return a promise from save, probably move elsewhere to a utils area
//or figure out if i can use saveQ
var saveInPromise = function(model) {
    //var promise = new mongoose.Promise();
    var deferred = Q.defer();
    model.save(function(err, result) {
        //promise.resolve(err, result);
        deferred.resolve(err, result);
    });
    return deferred.promise;
};
