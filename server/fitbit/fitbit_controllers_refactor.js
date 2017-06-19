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
        function (accessToken, refreshToken, profile, done) {
            var timestamp = new Date();
            userId = profile.id;
            
            console.log("fitbitStrategy()");
            console.log("fitbitStrategy() accessToken: " + accessToken);
            console.log("fitbitStrategy() refreshToken: " + refreshToken);
            console.log("fitbitStrategy() profile:");
            console.log(JSON.stringify(profile));
            
            process.nextTick(function () {
                var promise = User.findById({
                    _id: userId
                }).exec();
                promise.then(function (foundUser) {
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
                })
                .then(function () {
                    // re-logging in changes the token and secret, so in any case we must update it
                    // the second parameter is null because it expects a potential callback
                    return exports.getAllData(userId, null, accessToken, refreshToken);
                })
                .fail(function (err) {
                    console.log("fitbitStrategy()");
                    console.log("Eror printed below:");
                    console.log(JSON.stringify(err));
                })
                .done();
            });
        }),

    sendBrokenResponse: function (req, res, next) {
        console.log('gets to the broken response');
        res.sendStatus(200);
    },

    setupRefresh: function (req, res) {
        var id = req.body.userId;
        console.log("setupRefresh: userId: " + id);

        var accessToken = req.body.accessToken;
        console.log("setupRefresh: accessToken: " + accessToken);

        var refreshToken = req.body.refreshToken;
        console.log("setupRefresh: refreshToken: " + refreshToken);

        exports.refreshAccessToken(id, accessToken, refreshToken);
        res.sendStatus(200);
    },

    refreshAccessToken: function (id, accessToken, refreshToken) {
        console.log("refreshAccessToken() start");
        //var id = req.body.userId;
        console.log("userId: " + id);
        //var accessToken = req.body.accessToken;
        console.log("accessToken: " + accessToken);
        //var refreshToken = req.body.refreshToken;
        console.log("refreshToken: " + refreshToken);
        var expiresInSeconds = 3600;
        console.log("refreshAccessToken() 1");
        var promise = User.findById({
            _id: id
        }).exec();
        console.log("refreshAccessToken() 2");
        promise.then(function (user) {
            var client = new FitbitApiClient(FITBIT_CONSUMER_KEY, FITBIT_CONSUMER_SECRET);

            //console.log("printing user");
            //console.log(user); //prints correctly
            console.log("refreshAccessToken() 3");
            console.log("printing client");
            console.log(JSON.stringify(client));

            return client.refreshAccessToken(accessToken, refreshToken, expiresInSeconds).then(function (result) {
                console.log("refreshAccessToken() 4");
                //save access token and refresh token for user
                //result.access_token & result.refresh_token
                console.log("client.refreshAccessToken()");
                console.log("result: " + JSON.stringify(result));
                user.accessToken = result.access_token;
                console.log("new accessToken: " + user.accessToken);
                user.refreshToken = result.refresh_token;
                console.log("new refreshToken: " + user.refreshToken);
                return user;
            })
            .fail(function (error) {
                console.log("refreshAccessToken() client.refreshAccessToken()");
                console.log("error printed below");
                console.log(JSON.stringify(error));
            });
        })
        .then(function (user) {
            console.log("save user object");
            saveInPromise(user);
        })
        .fail(function (error) {
            console.log("refreshAccessToken() promise.then()");
            console.log("error printed below");
            console.log(JSON.stringify(error));
        })
        .done(function () {
            console.log("refreshAccessToken() end");
        });
    },

    getOauthToken: function (req, res, next) {
        console.log('getOauthToken() req.query:');
        console.log(JSON.stringify(req.query));
        //this looks like {"code":"51ad51ce2426860680cb323117373ea926469438"}
        
        //var userToken = req.query['oauth_token']; //remember the user should save this, db needs do nothing with it
        var userToken = req.query['code'];//changed to this based on console.log

        var server_token = jwt.sign({
                id: userId
            },
            process.env.SECRET || "secret", {
                //expiresIn: "7d"
                expiresIn: "1h" //1 hour to test refreshTokens
            }
        );
        console.log("getOauthToken() userToken: " + userToken);
        console.log("getOauthToken() server_token: " + server_token);
        console.log("getOauthToken() userId: " + userId);

        res.redirect('?oauth_token=' + server_token + '&userId=' + userId); //this should never be viewed by the user, just ending the res, change to res.end later
    },

    subscribeUser: function (fitbitAccessToken, fitbitRefreshToken, id) { //subscribe this user so we get push notifications
        var client = new FitbitApiClient(FITBIT_CONSUMER_KEY, FITBIT_CONSUMER_SECRET);
        client.post('/apiSubscriptions/' + id + '.json', fitbitAccessToken);
    },

    //chance try refresh start 11/3 - this works -> send refresh token back or call another function that sends back new access token
    validateUserToken: function (req, res) { //subscribe this user so we get push notifications
        var accessTokenMatches = false;
        //find the user in the DB
        var fitbitAccessToken = req.body.fitbitAccessToken;
        console.log("validateUserToken() fitbitAccessToken: " + fitbitAccessToken);
        var userId = req.body.userId;
        console.log("validateUserToken() userId: " + userId);

        var promise = User.findById({
            _id: userId
        }).exec();

        promise.then(function (foundUser) {
                if (foundUser) {
                    console.log("validateUserToken() promise.then() foundUser: " + JSON.stringify(foundUser));
                    //if the accessToken for the found user equals the accessToken passed
                    if (foundUser.accessToken === fitbitAccessToken) {
                        accessTokenMatches = true;
                    }
                }
                //return accessTokenMatches;
                res.send("" + accessTokenMatches);
            })
            .fail(function (err) {
                console.log("validateUserToken() promise.fail()");
                console.log("error printed below")
                console.log(JSON.stringify(err));
            })
            .done();
    },
    //chance try refresh end 11/3

    pushNotification: function (req, res, next) {

        var users = req.body;
        for (var j = 0; j < users.length; j++) {
            (function (i) {

                var promise = User.findById({
                    _id: users[i].ownerId
                }).exec();
                promise.then(function (user) {
                        user.needsUpdate = true;
                        return user;
                    })
                    .then(function (user) {
                        return saveInPromise(user);
                    })
                    .fail(function (err) {
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
    finishLogin: function (req, res, next) {
        console.log("finishLogin() req.query:");
        console.log(JSON.stringify(req.query));
        console.log("finishLogin() oauth_token: " + req.query['oauth_token']);
        console.log("finishLogin() userId: " + req.query['userId']);

        if (req.query['oauth_token'] && req.query['userId']) {
            res.sendFile(path.resolve('./static/loggedIn.html'));
        } else {
            next();
        }
    },

    retrieveData: function (req, res, next) {
        console.log('retreiveData() req.params:');
        console.log(JSON.stringify(req.params));//looks like {"id":"3KJZG4"}

        var id = req.params.id;
        console.log("retreiveData() id: " + id);
        exports.getAllData(id);
        res.sendStatus(200);
    },

    getAllData: function (id, cb, accessToken, refreshToken) {
        console.log("getAllData() id: " + id);
        console.log("getAllData() accessToken: " + accessToken);//this isnt even sent
        console.log("getAllData() refreshToken: " + refreshToken);//this isnt even sent

        var client = new FitbitApiClient(FITBIT_CONSUMER_KEY, FITBIT_CONSUMER_SECRET);
        var dateCreated;

        var promise = User.findById({
            _id: id
        }).exec();

        promise
            .then(function (user) {
                console.log("getAllData() 0");

                if (accessToken && refreshToken) {
                    console.log("getAllData() 1");
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
                    console.log("getAllData() 2");
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
                    console.log("getAllData() 3");
                    promiseArray.push(client.get(hpURL, user.accessToken));
                }

                var yesterdayEqualsLastChecked = yesterday.yyyymmdd() === lastChecked;
                if (!yesterdayEqualsLastChecked) {
                    console.log("getAllData() 4");
                    var num = datesArr.length - 7 > 0 ? datesArr.length - 7 : 0; //only check the last 7 days
                    user.stringLastChecked = datesArr[datesArr.length - 1]; //this importantly sets our last checked variable
                    for (var i = datesArr.length - 1; i >= num; i--) {
                        promiseArray.push(client.get('/activities/date/' + datesArr[i] + '.json', user.accessToken));
                    }
                }

                return Q.all(promiseArray)
                    .then(function (results) {
                        console.log("Logging Results:");
                        console.log(results);
                        console.log("getAllData() 5");
                        //TODO - each processing part should be in its own function probably, just doing it this way to try the refactor

                        //process profile
                        var profile = results[0][0]['user'];
                        user.profile.avatar = profile.avatar;
                        user.provider = 'fitbit';
                        user.profile.displayName = profile.displayName;

                        console.log("getAllData() 6");
                        //process friends
                        var friends = results[1][0]['friends'];
                        var currentFriends = user.friends;
                        var fitbitFriends = [];
                        for (var i = 0; i < friends.length; i++) {
                            fitbitFriends.push(friends[i].user.encodedId);
                        }

                        console.log("getAllData() 7");
                        // get unique friends
                        for (var i = 0; i < currentFriends.length; i++) {
                            if (fitbitFriends.indexOf(currentFriends[i]) < 0) {
                                fitbitFriends.push(currentFriends[i]);
                            }
                        }
                        user.friends = fitbitFriends;

                        console.log("getAllData() 8");
                        //process steps
                        var activities_tracker_steps = results[2][0]['activities-tracker-steps'];
                        user.attributes.experience = user.attributes.experience || 0;
                        user.fitbit.experience = utils.calcCumValue(activities_tracker_steps);
                        var level = utils.calcLevel(user.fitbit.experience + user.attributes.experience, user.attributes.level);
                        user.attributes.skillPts = utils.calcSkillPoints(user.attributes.skillPts, level, user.attributes.level);
                        user.attributes.level = level;

                        console.log("getAllData() 9");
                        //process sleep vitality
                        var sleep_minutesAsleep_vitality = results[3][0]['sleep-minutesAsleep'];
                        user.fitbit.vitality = utils.calcVitality(sleep_minutesAsleep_vitality);

                        console.log("getAllData() 10");
                        //process distance
                        var activities_tracker_distance = results[4][0]['activities-tracker-distance'];
                        user.fitbit.endurance = utils.calcEndurance(activities_tracker_distance);

                        console.log("getAllData() 11");
                        //process active minutes
                        var activities_minutesVeryActive = results[5][0]['activities-minutesVeryActive'];
                        user.fitbit.attackBonus = utils.calcAttackBonus(activities_minutesVeryActive);

                        console.log("getAllData() 12");
                        //process sleep hp recovery
                        if(results[6]){
                        var sleep_minutesAsleep_hprecovery = results[6][0]['sleep-minutesAsleep'] !== "undefined" ? results[6][0]['sleep-minutesAsleep'] : null;
                        console.log('sleep_minutesAsleep_hprecovery: ' + sleep_minutesAsleep_hprecovery);
                        if ((hpLastChecked !== today || HPChecker.foundSleep !== true) && sleep_minutesAsleep_hprecovery) {
                            console.log("getAllData() 12.5");
                            user.HPChecker.dateLastChecked = new Date();
                            user.fitbit.HPRecov = utils.calcHpRecov(sleep_minutesAsleep_hprecovery);
                            if (user.fitbit.HPRecov > 0) {
                                user.HPChecker.foundSleep = true;
                            }
                        }
                        } else {
                            console.log("getAllData() no results[6]");
                        }                    

                        console.log("getAllData() 13");
                        //process last week activities
                        var dexterity = 0;
                        var strength = 0;
                        //for (var i = 7; i < 14; ++i) {
                        if(results[7]){
                            var activities_workouts = results[7][0]['activities'];
                            //var activities_workouts = results[i][0]['activities']; //getting an error here because it is empty array
                            dexterity += utils.calcStrDex(activities_workouts, fitIds.dexterityIds);
                            strength += utils.calcStrDex(activities_workouts, fitIds.strengthIds);
                        //}
                        user.fitbit.dexterity = user.fitbit.dexterity + dexterity;
                        user.fitbit.strength = user.fitbit.strength + strength;
                        } else {
                            console.log("getAllData() no results[7]");
                        }
                        
                        console.log("getAllData() 14");
                        return user;
                    })
                    .fail(function (err) {
                        console.log("getAllData() Q.all fail");
                        console.log(err);
                    });
            })
            .then(function (user) {
                //console.log(JSON.stringify(user));
                return saveInPromise(user);
            })
            .fail(function (err) {
                console.log("getAllData()");
                console.log("error printed below");
                console.log(JSON.stringify(err));
                //TODO chance refresh token stuff
            })
            .done();
    },

    getActivitiesDateRange: function (req, res, next) {
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

        promise
            .then(function (user) {
                return client.get(url, user.accessToken)
                    .then(function (results) {
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
            .fail(function (err) {
                console.log(err);
            })
            .done();
    },

    // Possible activities are calories, steps, distance, elevation, floors
    getActivitiesTimeRange: function (req, res, next) {
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
        promise
            .then(function (user) {
                return client.get(url, user.accessToken)
                    .then(function (results) {
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
            .fail(function (err) {
                console.log(err);
            })
            .done();
    }
};

// Reformatting of dates to fit Fitbit preferred date format in API calls
Date.prototype.yyyymmdd = function () {
    var yyyy = this.getFullYear().toString();
    var mm = (this.getMonth() + 1).toString(); // getMonth() is zero-based
    var dd = this.getDate().toString();
    return yyyy + '-' + (mm[1] ? mm : "0" + mm[0]) + '-' + (dd[1] ? dd : "0" + dd[0]);
};

Date.prototype.addDays = function (days) {
    var dat = new Date(this.valueOf());
    dat.setDate(dat.getDate() + days);
    return dat;
};

Date.prototype.subtractDays = function (days) {
    var dat = new Date(this.valueOf());
    dat.setDate(dat.getDate() - days);
    return dat;
};

var getDatesArray = function (startDate, stopDate) {
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
var saveInPromise = function (model) {
    //console.log("saveInPromise()");
    //console.log(JSON.stringify(model));
    //var promise = new mongoose.Promise();
    var deferred = Q.defer();
    model.save(function (err, result) {
        //promise.resolve(err, result);
        deferred.resolve(err, result);
    });
    return deferred.promise;
};