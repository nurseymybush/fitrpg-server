'use strict';

var bodyParser     = require('body-parser'),
    cookieParser   = require('cookie-parser'),
    middle         = require('./middleware'),
    mongoose       = require('mongoose-q')(), //mongoose-q then requires mongoose
    morgan         = require('morgan'),
    methodOverride = require('method-override'),
    session        = require('express-session'),
    RedisStore = require('connect-redis')(session),
    expressJwt     = require('express-jwt');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fitApp');
/*
 * Include all your global env variables here.
*/
module.exports = exports = function (app, express,passport, routers) {
  app.set('port', process.env.PORT || 9000);
  app.set('base url', process.env.URL || 'https://localhost');
  app.use(cookieParser());
  app.use(morgan('dev'));
  
  app.use(bodyParser.urlencoded({
      extended: true
  }));
  app.use(bodyParser.json());
  app.use(middle.cors);
  app.use(session({
      store: new RedisStore(),
      secret: process.env.SECRET || 'secret', 
      maxAge: 360 * 5, 
      resave: true, 
      saveUninitialized: true
  }));
  /*
   * passport.initialize() middleware is required to initialize Passport.
   * Because this application uses persistent login sessions, passport.session()
   * middleware must also be used. If enabling session support, express.session()
   * must be used BEFORE passport.session() to ensure that the login is
   * restored in the correct order.
   */
  app.use(passport.initialize());
  app.use(passport.session());
  app.use('/fitbit', routers.FitbitRouter);
  app.use('/jawbone', routers.JawboneRouter);
  app.use('/api', expressJwt({secret: process.env.SECRET || 'secret'}))
  app.use('/api/users' , routers.UserRouter);
  app.use('/api/solos' , routers.SoloRouter);
  app.use('/api/groups', routers.GroupRouter);
  app.use('/api/pastsolos' , routers.PastSoloRouter);
  app.use('/api/pastgroups', routers.PastGroupRouter);
  app.use('/api/items', routers.ItemRouter);
  app.use('/api/battles', routers.BattleRouter);
  app.use('/api/quests', routers.QuestRouter);
  app.use('/feedback', routers.FeedbackRouter);
  app.use('/settings', routers.SettingsRouter);
  app.use(middle.logError);
  app.use(middle.handleError);
  app.use(methodOverride());

};
