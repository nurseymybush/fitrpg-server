'use strict'
//var controller = require('./fitbit_controllers.js');
var controller = require('./fitbit_controllers_refactor.js');//TODO CHance test, remove this
var User = require('../user/user_model.js');
var refresh = require('passport-oauth2-refresh');

module.exports = exports = function(router, passport) {

  // see if we can set this elsewhere
  passport.serializeUser(function (user, done) {
    done(null, user._id);
  });

  passport.deserializeUser(function (id, done) {
    User.findOne({_id: id}, function (err, user) {
      done(err, user); //this will throw an error in the server logs but we don't care, we don't need passport beyond this
    });
  });

  router.route('/push')
    .post(controller.pushNotification);

  /* Will later have to move the following route once we have jawbone data as well */
  router.route('/refresh/:id')//chance uncomment 6-18-17 because the id is undefined in fitbitcontroller
  //.get(controller.setupRefresh);
    .get(controller.retrieveData);//chance change this 3-16-17
    //router.use('/refresh',controller.setupRefresh);
    //.get(controller.refreshAccessToken);

    router.route('/authrefresh/:userId/:accessToken/:refreshtoken')
    .get(controller.setupRefresh);


  router.route('/daterange/:id/:type/:activity/:startDate/:endDate')
    .get(controller.getActivitiesDateRange);

  
  /* WORKING ROUTE FOR QUESTS THROUGH MIDNIGHT */
  router.route('/new/timerange/:id/:activity/:startDate/:startTime/:endTime')
    .get(controller.getActivitiesTimeRange);

  /* BACKWARDS COMPATIBLE - KEEPING THIS ROUTE */
  router.route('/timerange/:id/:activity/:startDate/:endDate/:startTime/:endTime')
    .get(controller.getActivitiesTimeRange);

  /* This is the route that catches post log in, which is usually closed automatically, 
     but sometimes it doesn't close so we have a button to close. We also want to  */  
  router.route('/authcallback')
    .get(controller.finishLogin);

  passport.use(controller.fitbitStrategy);
  refresh.use(controller.fitbitStrategy);//refresh token CHANCE

  router.use('/auth', passport.authenticate('fitbit'));
  //router.use('/auth', passport.authenticate('auth0'));//chance try auth0
  
  //validate the passed token and userid
  router.use('/validate', controller.validateUserToken);

  // for fitbit it's a twp step process and we have to do passport auth twice
  router.use('/authcallback', passport.authenticate('fitbit'));
  //router.use('/authcallback', passport.authenticate('auth0')); //chance try auth0
  
  router.use('/authcallback', controller.getOauthToken);
};