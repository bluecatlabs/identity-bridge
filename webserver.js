var proteus = require('./proteus.js')
var config = require('./settings.json')
var middleware = require('./middleware.js')
var fs = require('fs')
var shasum = require('shasum')

// ACTORS:
var exec = require('child_process').exec
var ActiveDirectory = require('activedirectory');

//////////////////////////////////////////////////
// CONFIG values from setting.json
// We share these with middleware
//////////////////////////////////////
var webui_port = config.webui_port ? config.webui_port : 80
var debug = config.debug
var bam_ip = config.bam_ip
var bam_user = config.bam_user
var bam_pass = config.bam_pass
var bam_config = config.bam_config
var mac_pool_name = config.mac_pool_name
var vip_tag_group = config.vip_tag_group
var vip_group_limit = config.vip_group_limit
var corp_tag_group = config.corp_tag_group
var corp_group_limit = config.corp_group_limit
var ldap_host = config.ldap_host
var ldap_basedn = config.ldap_basedn
var ldap_user = config.ldap_user
var ldap_password = config.ldap_password
//////////////////////////////////////////////////

// AD Config
var adconfig = { url: 'ldap://' + ldap_host,
               baseDN: ldap_basedn,
               username: ldap_user,
               password: ldap_password }
var ad = new ActiveDirectory(adconfig);
var _ = require('underscore');

// Web server objects
var cors = require('cors')
var express = require('express')
var app = express()
var webui_port = config.webui_port
var routesObj = require ('./routes.json')

app.use(cors())
app.use(express.static('webui'))

//////////// IMPORTANT: DO NOT TOUCH ////////////////////////////////
// This is the upload function that uploads the middleware. ////////
// this part should never be changed or updated ////////////////////

var formidable = require('formidable')
app.post ('/upload', function (req, res) {
	var form = new formidable.IncomingForm()
	form.uploadDir = "../uploads"
	form.keepExtension = true

	form.on('file', function (field, file) {
		
		var newfilename = form.uploadDir + "/" + file.name
		fs.rename (file.path, newfilename, function (err) {
			if (err) console.log ('Middleware: UPDATER: Backup file already exists:' + file.name)

		console.log ("Reading file : " + newfilename)
		fs.readFile (newfilename, function (err, buf) {
			var thissum = shasum(buf)
			var parts = file.name.split("-")
			var version = parts[2]
			var orig_sum = parts[3].split(".")[0] 

			console.log(orig_sum)
			if (thissum == orig_sum) {
				console.log ("Valid checksum, update can be applied to version: " + version)
				exec("sudo ./update-script " + version, function (err, stdout, stderr) {
					console.log ("update in progress .......")
				})
			}
		})

		})
	})

	form.on('end', function () {
		res.end('success')
	})

	form.parse(req)
})

////
//////////// END OF IMPORTANT: DO NOT TOUCH ////////////////////////////////

////////////////////////////////////////////////
////////////// BAM initialization functions
function handleSetupErr(err) {
        console.log ("ERROR: bam(setup): " + err)
}

function BAMInit (config_name) {

        BAM.getConfig(config_name).then(function (config_id) {
                if(debug) console.log ("DEBUG: middleware(init): read configuration id = " + config_id)

                BAM.getTagGroup (vip_tag_group).then (function (grp_id) {
                        BAM.setVipLimit(grp_id, vip_group_limit)
                }, handleSetupErr)

                BAM.getTagGroup (corp_tag_group).then (function (grp_id) {
                                BAM.setCorpLimit(grp_id, corp_group_limit)
                }, handleSetupErr)

                BAM.getDefaultMacPool (mac_pool_name)

        }, handleSetupErr)

}

// Initialize BAM to read the config id and the tag group ids.
// Set the IP limits according to the config

var BAM = new proteus(bam_ip, bam_user, bam_pass)
BAMInit(bam_config)
setInterval (function () {
        BAM.login()
}, 10 * 60 * 100)
/////////////////// END of BAM Initialization functions

routesObj.routes.forEach (function (route) {
	console.log (route)
	app.get (route.route, function (req, res) {
		if (debug) console.log ("DEBUG: route " + route.route + " called")
		if (route.actor == 'exec') {
			exec (route.argument, function (err, stdout, stderr) {
				err ? res.end(err) : res.end(stdout)
			})
		}

		if (route.actor == 'BAM') {
			var args = []
			
			// Load parameters
			route.params.forEach (function (param) {
				if (req.query[param]) args.push(req.query[param])
			})

			BAM[route.function] (args).then (function (result) {
				if (result.toString().indexOf('ERROR') >= 0) {
					res.end(result)
				} else {
					res.end("success: added vip user")
				}
			}, function (err) {
				res.end(err)
			})
		}

		if (route.actor == 'AD') {
			var args = []

			// Load parameters
			route.params.forEach (function (param) {
				if (req.query[param]) args.push(req.query[param])
			})
			var querystr = route.query + args[0]
			if (route.wildcard) {
				querystr += '*'
			}

			console.log (querystr)
			ad.find(querystr, function(err, results) {

				console.log (results)
				if ((err) || (! results)) {
					res.end("")
  				}

				var matches = []
				var users = 0
				if (results && results.users && results.users.length) {
					users = results.users.length
					results.users.forEach (function (user) {
						matches.push(user.sAMAccountName)
						users--
						if (users == 0) {
							res.end(matches.toString())
						}
					})
				} else {
					res.end('No match')
				}
			})
		}
	})
})

app.listen(webui_port);
