"use strict";

//var env = require('dotenv').load(); //using heroku env vars now
var User = require('../user/user_model.js');
var FitbitStrategy = require('passport-fitbit-oauth2').FitbitOAuth2Strategy
  //var Auth0Strategy = require('passport-auth0'); //chance try auth0
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
  /*fitbitStrategy: new Auth0Strategy({
      domain: process.env.AUTH0_DOMAIN,
      clientID: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      callbackURL: host + '/fitbit/authcallback'
    },*/
  fitbitStrategy: new FitbitStrategy({
      clientID: FITBIT_CONSUMER_KEY,
      clientSecret: FITBIT_CONSUMER_SECRET,
      callbackURL: host + '/fitbit/authcallback',
      scope: ['activity', 'heartrate', 'location', 'nutrition', 'profile', 'settings', 'sleep', 'social', 'weight']
    },
    function(accessToken, refreshToken, profile, done) {
      //function(accessToken, refreshToken, extraParams, profile, done) {
      var timestamp = new Date();
      //console.log(profile.id);//the userid is wrong when requesting, i need to see what value is
      //should be able to see in heroku log - this doesnt show in heroku

      //console.log(accessToken);
      //console.log(refreshToken); //this is undefined
      //console.log(extraParams);
      //console.log(JSON.stringify(profile));
      //the below is in an array that looks like identities[{"provider":"fitbit","user_id":"3KJZG4","connection":"fitbit","isSocial":true}]
      //var userId = profile.identities[0].user_id; //needed to send back with the url to the client to save to local storage
      userId = profile.id; //chance test new way
      //console.log(JSON.stringify(userId)); //chance test - prints to heroku logs
      //userId = userIdTemp.slice(0, userIdTemp.length - 4);-ddint get rid of the _=_ stuff
      process.nextTick(function() {
        //User.findByIdQ({
          //User.findById({
          //  _id: userId
          //})
        var promise = User.findById({_id: id}).exec();
        promise.then(function(foundUser) {
            if (foundUser) {
              done(null, foundUser);
            } else {
              var currentUser = new User({
                _id: userId,
                createdAt: timestamp,
                accessToken: accessToken,//chance add to fix undefined errors
                refreshToken: refreshToken//chance add to fix undefined errors
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
  //chance refresh token
  send401Response: function() {
    return res.status(401).end();
  },
  getTempToken: function(req, res, next) {
    //Nothing happens here because it redirects to the Fitbit site
  },

  getOauthToken: function(req, res, next) {
    var userToken = req.query['oauth_token']; //remember the user should save this, db needs do nothing with it
    
    var server_token = jwt.sign({
        id: userId
      },
      process.env.SECRET || "secret", {
        expiresIn: "7d"
        //expiresIn: "1h"//1 hour to test refreshTokens
      }
    );
    res.redirect('?oauth_token=' + server_token + '&userId=' + userId); //this should never be viewed by the user, just ending the res, change to res.end later
  },
  
  //chance try refresh token start 11/1
  getOauthRefreshToken: function(req, res, next) {
    var userToken = req.query['oauth_token']; //remember the user should save this, db needs do nothing with it
    
    var server_token = jwt.sign({
        id: userId
      },
      process.env.SECRET || "secret", {
        //expiresIn: "1h"
        expiresIn:"7d"
      }
    );
    //below is not correct
    res.redirect('?oauth_token=' + server_token + '&userId=' + userId); //this should never be viewed by the user, just ending the res, change to res.end later
  },
  //chance try refresh token end 11/1

  subscribeUser: function(fitbitAccessToken, fitbitRefreshToken, id) { //subscribe this user so we get push notifications
    var client = new FitbitApiClient(FITBIT_CONSUMER_KEY, FITBIT_CONSUMER_SECRET);
    //client.requestResource("/apiSubscriptions/" + id + ".json", "POST", fitbitToken, fitbitSecret);
    client.post('/apiSubscriptions/' + id + '.json', fitbitAccessToken);
  },

  //chance try refresh start 11/3 - this works -> send refresh token back or call another function that sends back new access token
  validateUserToken: function(req, res) { //subscribe this user so we get push notifications
    var accessTokenMatches = false;
    //find the user in the DB
    var fitbitAccessToken = req.body.fitbitAccessToken;
    var userId = req.body.userId;
    //User.findById({
    //  _id: userId
    //})
    var promise = User.findById({_id: userId}).exec();
    promise.then(function(foundUser) {
      if (foundUser) {
        //if the accessToken for the found user equals the accessToken passed
        if(foundUser.accessToken === fitbitAccessToken){
          accessTokenMatches = true;
        }
      }
      //return accessTokenMatches;
      res.send("" + accessTokenMatches);
    })
    .fail(function(err) { console.log(err); })
    .done();
  },
  //chance try refresh end 11/3

  pushNotification: function(req, res, next) {

    var users = req.body;
    for (var j = 0; j < users.length; j++) {
      (function(i) {
        //User.findByIdQ({
        //User.findById({
        //    _id: users[i].ownerId
        //  })
        var promise = User.findById({_id: users[i].ownerId}).exec();
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
    //User.findByIdQ({
    var promise = User.findById({_id: id}).exec();
      //User.findById({
      //  _id: id
      //})
      //.then(function(user) {
      promise.then(function(user) {
        if (accessToken && refreshToken) {
          user.accessToken = accessToken;
          user.refreshToken = refreshToken
            //user.accessTokenSecret = tokenSecret;
        }
        dateCreated = user.createdAt.subtractDays(1).yyyymmdd(); // to make up for time zone mixing up, this is a buffer
        user.lastActive = user.lastActive || new Date(); //if new date this means they are a first time user
        // GET PROFILE DATA
        //return client.requestResource('/profile.json', 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
        return client.get('/profile.json', user.accessToken).then(function(results) {

          var profile = results[0];
          //console.log("in get profile data");
          //console.log(profile);
          user.profile.avatar = profile.user.avatar;
          user.provider = 'fitbit';
          user.profile.displayName = profile.user.displayName;
          return user;
        });
      })
      .then(function(user) {
        // GET FRIEND DATA
        //return client.requestResource('/friends.json', 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
        return client.get('/friends.json', user.accessToken).then(function(results) {
          var currentFriends = user.friends;
          var friends = results[0].friends;
          //console.log('in get friend data');
          //console.log(friends);
          var fitbitFriends = [];
          for (var i = 0; i < friends.length; i++) {
            fitbitFriends.push(friends[i].user.encodedId);
          }
          // get unique friends
          for (var i = 0; i < currentFriends.length; i++) {
            if (fitbitFriends.indexOf(currentFriends[i]) < 0) {
              fitbitFriends.push(currentFriends[i]);
            }
          }
          user.friends = fitbitFriends;
          return user;
        });
      })
      .then(function(user) {
        // GET ACTUAL STEPS, NOT LOGGED ONES
        //return client.requestResource('/activities/tracker/steps/date/' + dateCreated + '/today.json', 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
        return client.get('/activities/tracker/steps/date/' + dateCreated + '/today.json', user.accessToken).then(function(results) {
          user.attributes.experience = user.attributes.experience || 0;
          var activities_tracker_steps = results[0]['activities-tracker-steps'];
          //console.log('in get actual steps');
          //console.log(activities_tracker_steps);
          user.fitbit.experience = utils.calcCumValue(activities_tracker_steps);
          var level = utils.calcLevel(user.fitbit.experience + user.attributes.experience, user.attributes.level);
          user.attributes.skillPts = utils.calcSkillPoints(user.attributes.skillPts, level, user.attributes.level);
          user.attributes.level = level;
          return user;
        });
      })
      .then(function(user) {
        // GET SLEEP MINUTES AND CONVERT TO VITALITY
        //return client.requestResource('/sleep/minutesAsleep/date/' + dateCreated + '/today.json', 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
        return client.get('/sleep/minutesAsleep/date/' + dateCreated + '/today.json', user.accessToken).then(function(results) {
          var sleep_minutesAsleep = results[0]['sleep-minutesAsleep'];
          //console.log('in get minutes asleep');
          //console.log(sleep_minutesAsleep);
          user.fitbit.vitality = utils.calcVitality(sleep_minutesAsleep);
          return user;
        });
      })
      // GET DISTANCE AND CONVERT TO ENDURANCE
      .then(function(user) {
        //return client.requestResource('/activities/tracker/distance/date/' + dateCreated + '/today.json', 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
        return client.get('/activities/tracker/distance/date/' + dateCreated + '/today.json', user.accessToken).then(function(results) {
          console.log('in get distance');
          //console.log(results);
          var activities_tracker_distance = results[0]['activities-tracker-distance'];
          //console.log(activities_tracker_distance);
          user.fitbit.endurance = utils.calcEndurance(activities_tracker_distance);
          return user;
        });
      })
      // GET VERY ACTIVE MINUTES AND CONVERT TO ATTACK BONUS
      .then(function(user) {
        //return client.requestResource('/activities/minutesVeryActive/date/' + dateCreated + '/today.json', 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
        return client.get('/activities/minutesVeryActive/date/' + dateCreated + '/today.json', user.accessToken).then(function(results) {
          console.log('in get minutes very active');
          //console.log(results);
          var activities_minutesVeryActive = results[0]['activities-minutesVeryActive'];
          //console.log(activities_minutesVeryActive);
          user.fitbit.attackBonus = utils.calcAttackBonus(activities_minutesVeryActive);
          return user;
        });
      })
      .then(function(user) {
        // GET TIME ASLEEP FROM LAST CHECK AND USE IT TO CALC SLEEP HP RECOVERY, THIS NUMBER ONLY USED ONCE
        var HPChecker = user.HPChecker;
        var today = (new Date()).yyyymmdd();
        var dateLastChecked = HPChecker.dateLastChecked || user.createdAt;
        var hpLastChecked = dateLastChecked.yyyymmdd();
        // if we didn't check yet before today, we reset foundSleep to false
        if (hpLastChecked !== today) {
          HPChecker.foundSleep = false;
        }
        // if it's true and the dates do match then we don't do anything bc we've found sleep today
        if (hpLastChecked === today && HPChecker.foundSleep === true) {
          return user;
        }
        user.HPChecker.dateLastChecked = new Date(); //set the new lastchecked date to today
        var hpURL = '/sleep/minutesAsleep/date/' + hpLastChecked + '/today.json';
        //return client.requestResource(hpURL, 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
        return client.get(hpURL, user.accessToken).then(function(results) {
          var sleep_minutesAsleep = results[0]['sleep-minutesAsleep'];
          //console.log('in get asleep from last check');
          //console.log(sleep_minutesAsleep);
          user.fitbit.HPRecov = utils.calcHpRecov(sleep_minutesAsleep);
          if (user.fitbit.HPRecov > 0) {
            user.HPChecker.foundSleep = true;
          }
          return user;
        });
      })
      .then(function(user) {
        // GET WORKOUTS AND CALCULATE THEM TO BE DEXTERITY/STRENGTH
        var lastChecked = user.stringLastChecked || user.createdAt.subtractDays(1);
        var yesterday = (new Date()).subtractDays(1);
        var datesArr = getDatesArray(new Date(lastChecked), yesterday);
        if (yesterday.yyyymmdd() === lastChecked) {
          return user;
        }
        var answerPromises = [];
        var num = datesArr.length - 7 > 0 ? datesArr.length - 7 : 0; //only check the last 7 days
        user.stringLastChecked = datesArr[datesArr.length - 1]; //this importantly sets our last checked variable
        for (var i = datesArr.length - 1; i >= num; i--) {
          //var a = client.requestResource('/activities/date/' + datesArr[i] + '.json', 'GET', user.accessToken, user.accessTokenSecret);
          var a = client.get('/activities/date/' + datesArr[i] + '.json', user.accessToken);

          answerPromises.push(a);
        }
        return Q.all(answerPromises)
          .then(function(results) {
            var dexterity = 0;
            var strength = 0;
            for (var i = 0; i < results.length; i++) {
              var activities_workouts = results[i][0]['activities'];
              //console.log('in get workouts');
              //console.log(activities_workouts);
              dexterity += utils.calcStrDex(activities_workouts, fitIds.dexterityIds);
              strength += utils.calcStrDex(activities_workouts, fitIds.strengthIds);
            }
            user.fitbit.dexterity = user.fitbit.dexterity + dexterity;
            user.fitbit.strength = user.fitbit.strength + strength;
            return user;
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

    // get inactive minutes - we do nothing with this right now
    // client.requestResource('/activities/minutesSedentary/date/'+date+'/today.json','GET',fitbitToken,fitbitSecret).then(function(results){
    //   User.findById(id,function(err,user) {
    //     if (err) {throw err};
    //     user.fitbit.inactiveMinutes = JSON.parse(results[0])['activities-minutesSedentary'];
    //     user.save();
    //   });
    // });

  },

  getActivitiesDateRange: function(req, res, next) {
    var client = myClient;
    var id = req.params.id;
    var type = req.params.type; //will be 'sleep' or 'activities'
    var activity = req.params.activity;
    var startDate = req.params.startDate;
    var endDate = req.params.endDate;
    var qString = type + '-' + activity;
    var url = '/activities/' + activity + '/date/' + startDate + '/' + endDate + '.json';// this was /steps/steps/date/2016-10-21/2016-10-21.json
    console.log(url);
    //User.findByIdQ({
      //User.findById({
      //  _id: id
      //})
    var promise = User.findById({_id: id}).exec();

    promise.then(function(user) {
        //return client.requestResource(url, 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
        return client.get(url, user.accessToken).then(function(results) {

          if (activity === 'distance') {
            console.log(JSON.stringify(results[0]));
            var total = utils.calcDecValue(results[0][qString]);//issue is here, qString was distance-distance
            res.json({
              total: total
            });
          } else {
            console.log(JSON.stringify(results[0]));
            var total = utils.calcCumValue(results[0][qString]);
            res.json({
              total: total
            });
          }
        });
      })
      .fail(function(err) {
        //commenting this out because crashes the server because you dont have user yet
        //var originalDecoded = jwt.decode(user.accessToken, {
        //  complete: true
        //}); //chance refresh token
        //jwt.refresh(originalDecoded, 3600, process.env.SECRET); //chance refresh token
        //res.sendStatus(err);
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
    //User.findByIdQ({
      //User.findById({
      //  _id: id
      //})
    var promise = User.findById({_id: id}).exec();
    promise.then(function(user) {
        //return client.requestResource(url, 'GET', user.accessToken, user.accessTokenSecret).then(function(results) {
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
        //res.sendStatus(err);
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
  var dat = new Date(this.valueOf())
  dat.setDate(dat.getDate() + days);
  return dat;
}

Date.prototype.subtractDays = function(days) {
  var dat = new Date(this.valueOf())
  dat.setDate(dat.getDate() - days);
  return dat;
}

var getDatesArray = function(startDate, stopDate) {
  var dateArray = new Array();
  var currentDate = startDate.addDays(1);
  var stopDate = stopDate;
  while (currentDate <= stopDate) {
    var fitbitCurDate = currentDate.yyyymmdd();
    dateArray.push(fitbitCurDate);
    currentDate = currentDate.addDays(1);
  }
  return dateArray;
}

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
}
