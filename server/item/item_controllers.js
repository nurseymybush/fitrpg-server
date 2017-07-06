'use strict'

var Item = require('./item_model.js');
var Q    = require('q');
var url = require('url');

module.exports = exports = {
  get : function(req, res, next) {
    var $promise = Q.nbind(Item.findById, Item);
    $promise(req.params.id)
      .then(function (item) {
        res.json(item);
      })
      .fail(function (reason) {
        next(reason);
      })
  },
  getListItems : function(req, res, next) {
    var query = Item.find({'_id': { $in: req.body.ids}});
    //$promise(req.params.idlist)
    Q(query.exec())
      .then(function (items) {
        res.json(items);
      })
      .fail(function (reason) {
        next(reason);
      })
  },
  getItems : function(req, res, next) {
    var $promise = Q.nbind(Item.find, Item);
    var url_parts = url.parse(req.url, true);
    var query = url_parts.query;
    $promise(query)
      .then(function (items) {
        res.json(items);
      })
      .fail(function (reason){
        next(reason);
      })
  },
  post : function(req, res, next) {
    var $promise = Q.nbind(Item.create, Item);
    $promise(req.body.item)
      .then(function (_id) {
        res.send(_id);
      })
      .fail(function (reason) {
        next(reason);
      })
  }
}
