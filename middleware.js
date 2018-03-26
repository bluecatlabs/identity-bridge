var proteus = require('./proteus.js')
var config = require('./settings.json')
//var ping = require('net-ping')
//var pinger = ping.createSession()

//////////////////////////////////////////////////
// These variables need to be read from a config file
// BAM Connectivity Parameters, User limits, etc.
var bam_ip = config.bam_ip
var bam_user = config.bam_user
var bam_pass = config.bam_pass
var bam_config = config.bam_config
var mac_pool_name = config.mac_pool_name
var vip_tag_group = config.vip_tag_group
var vip_group_limit = config.vip_group_limit
var corp_tag_group = config.corp_tag_group
var corp_group_limit = config.corp_group_limit
var debug = config.debug
var trace = config.trace
var remote_syslog_enable = config.remote_syslog_enable
var default_domain = config.default_domain ? config.default_domain : 'bukitmakmur'
//////////////////////////////////////////////////

//////////////////////////////// CISCO ISE PARAMETERS & SYSLOG READER  //////////////////////////////
var PORT = config.syslog_port
var HOST = config.syslog_server_address

var dgram = require('dgram');
var server = dgram.createSocket('udp4');

server.on('listening', function () {
    var address = server.address();
    if (debug) console.log('DEBUG: middleware(init): udp server listening on ' + address.address + ":" + address.port);
});

server.on('message', function (message, remote) {
	var data = message.toString()	
	processMessage(data)
})

server.bind(PORT, HOST);

//////////////////////////////// END - CISCO ISE PARAMETERS & SYSLOG READER //////////////////////////////


function handleSetupErr(err) {
	console.log ("initial setup error: " + err)
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

function processMessage (data) {
	if (trace) console.log (data)
	newmsg = data.match(/\s(.*)5200\sNOTICE(.*)UserName=(.*),(.*)Calling-Station-ID=(.{17})(.*)/)
	if (newmsg) {
		user = newmsg[3].split(',')[0]
		user = user.toLowerCase()

		var parts = user.split(/[\\]+/)
		var domain
		var name
		if (parts[1]) {
        		var domain = parts[0]
        		var name = parts[1]
		} else {
        		var domain = default_domain ? default_domain : 'bukitmakmur'
        		var name = parts[0]
		}

		user = domain + '\\\\' + name

		mac = newmsg[5]

		// Fix #4 - some mac addresses come with the format separator : instead of - causing a mismatch
		mac = mac.replace(/:/g, "-").toUpperCase()
		console.log ('Middleware: Detected 5200 Cisco ISE NOTICE with 802.1x (6,0) >> UserName: ' + user + ', MAC: ' + mac) 

		// Fix #3 - We found that in production, multple cisco messages come too quick for the same user 
		// causing a race condition.
		setTimeout ( function() {
			assign(user, mac)
		}, 100)
	}

	// Notify PALO ALTO if remote_syslog_enable is on
	if (remote_syslog_enable) {
		dhcpack = data.match(/DHCPACK on (.*) to (.{17}) /)
		if (dhcpack) {
			if(debug) console.log ("DEBUG: middleware: " + data)
			mac = dhcpack[2]
			mac = mac.replace(/:/g, "-").toUpperCase()
			ip = dhcpack[1]

			BAM.getMAC(mac).then(function(macobj) {

				var username = macobj.user.replace(/\\/, "")
				console.log ("NOTIFY: [" + Date() + "] Bluecat DHCP Allocated User:" + username + " IP:" + ip + " MAC:" + mac)
			})
		}
	}
}

function assign (user, mac) {

	BAM.getUser(user).then(function(userobj) {

		if(debug) console.log ("DEBUG: middleware(assign): found user: " + JSON.stringify(userobj))
		var mac_list = JSON.stringify(userobj.devices)

		////// Case 1 :
		//////		if mac is already with this user, do nothing
		////// Case 2 :
		//////		if user is within the speficied limit, unlink and link
		////// Case 3 : 
		//////		if user is above limit, ping test !

		if (mac_list.indexOf(mac) <= 0) {
			if (userobj.devices.length < userobj.limit ) {

				if (debug) console.log ("DEBUG: middleware(assign): safelimit : add a new mac and tie it to user(" + userobj.username + ")")
				BAM.getMAC(mac).then(function(macobj) {

					if (debug) console.log ("DEBUG: middleware(assign): found mac: " + JSON.stringify(macobj))
					// If this mac is already linked to an old user.
					// We unlink it from the old user here.
					// Unlinking removes the mac from the old mac pool if it belonged to a VIP users mac pool
					if (macobj.userid || macobj.macpool) {
						BAM.unlinkMACFromUser(macobj, 0)	
					}
				
					// We link to the new user in either case.
					// Linking automatically adds the mac to the VIP user's / the "allowedmacs" mac pool
					BAM.linkMACToUser(macobj, userobj)

				}, function () {
					// For a MAC that is not in BAM Yet, 
					// we just link add and link it to the new user.
				})
			} else {
				if (debug) console.log ("DEBUG: middleware(assign): exceeded limit(" + userobj.username + ") : performing ping check")
				var freemacs = []
				var devices = userobj.devices.length
				userobj.devices.forEach(function (device) {
					BAM.getIPForMAC (device.macid).then (function (ip) {
						if (ip) {
							if (debug) console.log ("DEBUG: need to perform a ping check for user:" + userobj.username + " ip:" + ip)
							pinger.pingHost (ip, function (error, ip) {
								devices--
								if (error) freemacs.push(device.mac)

								// This gets fired after a ping is successfully done on all mac devices.
								if (devices == 0) {
									if (debug) console.log ("DEBUG: ping check for user:" + userobj.username + " freemacs:" + freemacs)
									if (freemacs && freemacs[0]) {	
										BAM.getMAC(freemacs[0]).then(function (oldmacobj) {
											if (oldmacobj.userid || oldmacobj.macpool) {
												BAM.unlinkMACFromUser(oldmacobj, 1)
											}
										})

										BAM.getMAC(mac).then(function(macobj) {
											BAM.linkMACToUser(macobj, userobj)
										})
									}
								}
							})
						} else {
							devices--
							freemacs.push(device.mac)

							// This gets fired after a ping is successfully done on all mac devices.
							if (devices == 0) {
								if (debug) console.log ("DEBUG: ping check for user:" + userobj.username + " freemacs:" + freemacs)
								if (freemacs && freemacs[0]) {	
									BAM.getMAC(freemacs[0]).then(function (oldmacobj) {
										if (oldmacobj.userid || oldmacobj.macpool) {
											BAM.unlinkMACFromUser(oldmacobj, 1)
										}
									})

									BAM.getMAC(mac).then(function(macobj) {
										BAM.linkMACToUser(macobj, userobj)
									})
								}
							}
						}
					})
				})
			}
		} else {
			if (debug) console.log ("DEBUG: middleware(assign): mac: "+mac+" already present for this user: " + user)
			
			// Update Palo Alto here as well. In this case, the IP is already present in the old BDDS lease
			// hence a new DHCPACK may not be generated.
			BAM.getMAC(mac).then(function(macobj) {

				// FIX: Faced an issue after cutover with linking to allowedmacs.
				// somehow the linking to macpool wasn't done the last time, we try to re-link here.
				BAM.linkMACToUser(macobj, userobj)

				BAM.getIPForMAC(macobj.macid).then(function (ip) {
					var username = user.replace(/\\/, "")
					if (ip) console.log ("NOTIFY: [" + Date() + "] Bluecat DHCP Allocated User:" + username + " IP:" + ip + " MAC:" + mac)
				})
			})
			
		}
	
	})
}

// Initialize BAM to read the config id and the tag group ids.
// Set the IP limits according to the config

var BAM = new proteus(bam_ip, bam_user, bam_pass)
BAMInit(bam_config)
setInterval (function () {
	BAM.login()
}, 10 * 60 * 100)

