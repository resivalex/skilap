var Step = require("step");
var DateFormat = require('dateformatjs').DateFormat;
var df = new DateFormat("yyyy.MM.dd");
var sprintf = require('sprintf').sprintf;
var _ = require('underscore');
var async = require('async');

module.exports = function account(webapp) {
	var app = webapp.web;
	var cashapi = webapp.api;
	var prefix = webapp.prefix;

	app.get(webapp.prefix+'/account', function(req, res, next) {
		var idx=0,c=0;
		var pageSize = 20;
		Step(
			function getData() {
				cashapi.getAccountInfo(req.query.id,["count"], this);
			},
			function render(err, data) {
				var count = data.count;
				var firstVisible = Math.max(0, count-pageSize);
				var scrollGap = pageSize*5;
				var firstDelivered = Math.max(0, count-pageSize-scrollGap);
				res.render(__dirname+"/../views/account", {
					settings:{views:__dirname+"/../views"},
					prefix:prefix,
					accountId:req.query.id,
					accountSize:count,
					firstVisible:firstVisible,
					pageSize:pageSize,
					scrollGap:scrollGap
				});
			},
			next
		);
	});

	app.post(webapp.prefix+'/account/:id/updatecell', function(req, res) {
		var newTr = null;
		Step(
			function getInfo () {
				cashapi.getTransaction(req.body.id, this.parallel());
				if (req.body.columnId==4)
					cashapi.getAccountByPath(req.body.value, this.parallel());
			},
			function update (err, tr, newAccId) {
				if (req.body.columnId == 5 || req.body.columnId == 6) {
					var newVal = eval(req.body.value);
					if (req.body.columnId == 6)
						newVal *= -1;
					newTr = {id:tr.id,splits:[]};
					tr.splits.forEach(function(split) {
					if (split.accountId == req.params.id)
						newTr.splits.push({id:split.id,value:newVal})
					else
						newTr.splits.push({id:split.id,value:newVal*-1})
					});
				} else if (req.body.columnId == 4 ) {
					if (newAccId!=null) {
						newTr = {id:tr.id,splits:[]};
						tr.splits.forEach(function(split) {
							if (split.accountId != req.params.id)
								newTr.splits.push({id:split.id,accountId:newAccId})
						});
					}
				} else if (req.body.columnId == 3 ) {
					newTr = {id:tr.id,description:req.body.value};
				} else if (req.body.columnId == 2 ) {
					var newDate = new Date(req.body.value);
					newTr = {id:tr.id,dateEntered:newDate,datePosted:newDate};
				}
				cashapi.saveTransaction(newTr, this);
				res.send(req.body.value);
			},
			function end(err) {
				if (err) console.log(err);
			}
		);
	});

	app.get(webapp.prefix+'/account/:id/getaccounts', function(req, res) {
		var tmp = [];
		Step (
			function getAccounts() {
				cashapi.getAllAccounts(this);
			},
			function getInfo(err, accounts) {
				var group = this.group();
				_.forEach(accounts, function (acc) {
					cashapi.getAccountInfo(acc.id, ["path"], group());
				});
			},
			function render(err, infos) {
				_.forEach(infos, function (info) {
					if (info.path.search(req.query.term)!=-1)
						tmp.push(info.path);
				});
				res.send(_.uniq(tmp));
			}, 
			function error (err) {
				if (err) res.send(["Error"]);
			}
		);
	});

	app.get(webapp.prefix+'/account/:id/getdesc', function(req, res) {
		var tmp = [];
		Step(
			function getRegister() {
				cashapi.getAccountRegister(req.params.id,0,null, this);
			},
			function getTransactions (err, register) {
				var group = this.group();
				_.forEach(register, function (trs) {
					cashapi.getTransaction(trs.id, group());
				});
			},
			function render (err, transactions) {
				_.forEach(transactions, function (tr) {
					if (tr.description.search(req.query.term)!=-1)
						tmp.push(tr.description);
				});
				res.send(_.uniq(tmp));
			}, 
			function error (err) {
				if (err) res.send(["Error"]);
			}
		);
	});

	app.get(webapp.prefix+'/account/:id/getgrid', function(req, res, next) {
		console.time("getAccountData");
		var data = {sEcho:req.query.sEcho,iTotalRecords:0,iTotalDisplayRecords:0,aaData:[]};
		var idx=Math.max(req.query.iDisplayStart,0);
		var count,register;
		Step(
			function getTransactionCount() {
				cashapi.getAccountInfo(req.params.id,["count"], this);
			},
			function getAccountRegister(err, data) {
				count = data.count;
				var limit = Math.min(count-idx,req.query.iDisplayLength);
				cashapi.getAccountRegister(req.params.id,idx,limit, this);
			},
			function getTransactions (err, register_) {
				register = register_;
				var group1 = this.group();
				var group2 = this.group();
				var aids = {};
				_.forEach(register, function (trs) {
					cashapi.getTransaction(trs.id,group1());
					aids[trs.recv[0].accountId]=trs.recv[0].accountId;
				});
				_.forEach(aids, function (aid) {
					cashapi.getAccountInfo(aid,["path"],group2());
				})
			},
			function render(err, transactions, accInfo) {
				if (err) console.log(err.stack);
				var t={}; _.forEach(accInfo, function (e) { t[e.id]=e; }); accInfo = t;
				var i;
				console.log({tr:_.size(transactions),trs:_.size(register)});
				for (i=0; i<_.size(register); i++) {
					var tr = transactions[i]; 
					var trs = register[i];
					var recv = trs.recv;
					var send = trs.send;
					var dp = new Date(tr.dateEntered);
					data.aaData.push([tr.id,idx+1,df.format(dp),tr.description,
						recv.length==1?accInfo[recv[0].accountId].path:"Multiple",
						send.value>0?sprintf("%.2f",send.value):null,
						send.value<=0?sprintf("%.2f",send.value*-1):null,
						sprintf("%.2f",trs.ballance)]);
				}
				console.log({idx:idx,total:count});
				if ((idx+i)==count) {
					data.aaData.push(["new",idx+1,df.format(new Date()),"",null,null,null,sprintf("%.2f",trs.ballance)]);
				}
				data.iTotalRecords = count+1;
				data.iTotalDisplayRecords = count+1;
				console.timeEnd("getAccountData");
				res.send(data);
			},
			next
		);
	});

}