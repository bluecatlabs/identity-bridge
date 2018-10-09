
// Copyright 2018 BlueCat Networks (USA) Inc. and its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var request = require('request')
var config = require('./settings.json')
var unique = require('array-unique')

var Q = require('q')
var debug = config.debug
var trace = config.trace
var fixed_vip_assignment = config.fixed_vip_assignment ? config.fixed_vip_assignment : 0
var default_domain = config.default_domain

bam = function (ip, user, pass) {

	var self = this

	self._deferred = Q.defer()
	self._ip = ip
	self._url = 'http://'+ip+'/Services/REST/v1/'
	self._headers = { 'Content-type' : 'application/json' }

	self._user = user
	self._pass = pass
	self._loggedin = 0;
	self._configId = 0;
	self._login = function () {

        	request (self._url + 'login?username='+self._user+'&password='+self._pass, 
		function (err, resp, body) {
			if (err) {
				console.log ("ERROR: bam(setup): " + err)
				self._deferred.reject(err)
				return
			}

       	        	var auth = body.match('-> (.*) <-')

			if (!auth) {
				console.log ("ERROR: bam: failed to connect to the BAM / invalid username / password")
				self._deferred.reject("Failed to connect to the BAM / invalid username/password")
			} else {
                		if (auth[1]) {
                        		self._headers['Authorization'] = auth[1] 
					self._loggedin = 1
					self._deferred.resolve('ok')
                		} else {
					self._deferred.resolve('invalid username/password is not right')
					console.log ("ERROR: bam: failed to connect to the BAM / invalid username / password")
				}
			}
        	})
	}
	self._login ()
	return;
}

bam.prototype.login = function () {
	var self = this
	self._login(self._user, self._pass)
}

// This restCall does both POST as well as GET.
// restCall returns a promise. 
// reject is used to return an error --> value is 0
// resolve is used to return the json object

bam.prototype.restCall = function ( fn, args, type, json ) {
	var self = this
	var url = self._url + fn

	// By default this will do HTTP GET
	if (!type) type = "GET"
	if (args)  url += args

	var deferred = Q.defer()

	// POST calls are mostly used for adding data to BAM.
	// Mostly addEntity or addTag in this case. 
	// In case of errors like duplicate entry, etc, we reject with a reason
	// 	else we resolve successfuly
	self._deferred.promise.then ( function () {

		if (trace) console.log ("TRACE: performing rest call: " + fn + args)
        	request ({ uri: url,
		 	   method: type,
			   json: json,
			   headers: self._headers }, 
		function (err, resp, body) {

			if (type == "PUT") console.log ("TRACE: rest call output: " + fn + args + " : " + body)
			var rejectstring = "ERROR: bam:" + fn + "("+args+"): "
			if (err) {
				deferred.reject(rejectstring + err)
			} else {

				// A successful Delete does not have the content-type header
				if ((type == "DELETE") && (!resp.headers['content-type'])) {
					deferred.resolve(body)
				}
				if (resp.headers['content-type'] && (resp.headers['content-type'] == 'application/json')) {
					if (trace) console.log ("TRACE: rest call output: " + fn + args + " : " + body)
					if (type == "GET") {
						var json = JSON.parse(body)
						if (json.id == 0) {
							deferred.reject(rejectstring + "object does not exist")
						} else {
							deferred.resolve(json)
						}
					} else {
						deferred.resolve(body)
					}
				} else {
					deferred.reject(rejectstring + body)
				}
			}
       	 	})
	})

	return deferred.promise;
}

/////////// INITIALIZATION FUNCTIONS used by BAMInit only //////////////
// All get functions use return the restCall, in case of an error, the promise is rejected.

bam.prototype.get = function (name, type, flag, parentid) {

	var self = this;
	var prop_str = ""
	var parent = 0

	if (type == 'MACPool') {
		parent = self._configId
		prop_str = "instantDeploy=true"
	}

	if (type == 'vipuser') {
		parent = self._vip
		type = 'Tag'
	}

	if (type == 'corpuser') {
		parent = self._corp
		type = 'Tag'
	}

	if (parentid) parent = parentid

        return self.restCall ('getEntityByName', '?parentId='+parent+'&type='+type+'&name=' + encodeURIComponent(name)).then(function (obj) {
		if (debug) console.log ("DEBUG: bam: found " + type + ' with name: ' + name + "("+ obj.id + ")")

		if (flag == 'DELETE') {
			return self.restCall ('delete', '?objectId='+obj.id, "DELETE")
		} else {

			if (flag =="CREATE") {
				if (obj.id == 0) {
					var newobj = { 'id': 0, 'name': name, 'type': type, 'properties': prop_str }
					return self.restCall ('addEntity', '?parentId='+parent, "POST", newobj).then(function(newid) {
						console.log ("DEBUG: bam: added " + type + ' with name: ' + name)
						return newid
					}, function (noobj) {
						console.log (noobj)
						return 0
					})
				} else {
					return (obj.id)
				}
			} else {
				return(obj.id)
			}
		}
	}, function (noobj) {
		if (flag == 'CREATE') {
			var obj = { 'id': 0, 'name': name, 'type': type, 'properties': prop_str }
			return self.restCall ('addEntity', '?parentId='+parent, "POST", obj).then(function(newid) {
				console.log ("DEBUG: bam: added " + type + ' with name: ' + name)
				return newid
			}, function (noobj) {
				console.log (noobj)
				return 0
			})
		}
		return 0
	})

}

bam.prototype.getConfig = function (configname) {
	var self = this;
        return self.restCall ('getEntityByName', '?parentId=0&type=Configuration&name=' + configname).then(function (obj) {
		self._configId = obj.id
		return(obj.id)
	})
}

bam.prototype.getDefaultMacPool = function (mac_pool_name) {
	var self = this;
        return self.restCall ('getEntityByName', '?parentId='+self._configId+'&type=MACPool&name=' + mac_pool_name).then(function (obj) {
		self._macPoolId = obj.id
		self._macPoolName = mac_pool_name
		return obj
	})
}

bam.prototype.getTagGroup = function (name) {
	var self = this;
	return this.restCall ('getEntityByName', '?name='+name+'&parentId=0&type=TagGroup', "GET").then (function (obj) {
		return (obj.id)
	})
}

bam.prototype.setVipLimit = function (id, access) {
	this._vip = id
	this._viplimit = access
}

bam.prototype.setCorpLimit = function (id, access) {
	this._corp = id
	this._corplimit = access
}
/////////// END OF INITIALIZATION FUNCTIONS used by BAMInit only //////////////


/////////// HELPER FUNCTIONS //////////////////////////////////////////////////
// Log REST API errors
function logError (err) {
	console.log (err)
}

//////////////////////////////////
// Adds a MAC Pool for a VIP user
// Links the newly created MAC pool to the VIP user
// Dependency -->
//	This should be called only when a VIP user exists otherwise the linkage fails!
/////////////////////////////////
function add_mac_pool (bamobj, username, userid) {
	var mac_pool_name = username + "-macs"

	if (debug) console.log ("DEBUG: bam(createVIPUser): adding a new mac pool for user: " + username)
	return bamobj.get(mac_pool_name, 'MACPool', "CREATE").then(function (macid) {

		if (trace) console.log ("TRACE: got a mac pool - result = " + macid)
		bamobj.restCall('linkEntities', '?entity1Id='+userid+'&entity2Id='+macid, "PUT")
		return macid

	}, logError)
}

function set_user_type (bamobj, userobj, type, id) {
	userobj.type = type
	userobj.limit = (type == 'vip') ? bamobj._viplimit : bamobj._corplimit
	userobj.userid = id

	// For corporate users, and vip users when fixed VIP assignment is turned off, 
	// we use the same mac pool "allowedmacs"
	if ((type == 'corp') || 
	   (type == 'vip') && (!fixed_vip_assignment)) {
		userobj.macpool = bamobj._macPoolName;
		userobj.macpoolid = bamobj._macPoolId;
	}
}

// Delete old DHCP range
// Add a new DHCP range
// Link the DHCP range to the user tag
// Apply allow mac pools on the DHCP range

function del_add_and_link_dhcp(bamobj, username, userid, macpoolid, networkid, iplist) {
	var range_name = username + '-range'

	if (debug) console.log ("DEBUG: bam(createVIPUser): deleting the old dhcp range: " + range_name)
	return bamobj.get(range_name, 'DHCP4Range', "DELETE", networkid).then (function (d) {

		// Add the DHCP range
		return bamobj.restCall('addDHCP4Range', 
		'?networkId='+networkid+'&start='+iplist[0]+'&end='+iplist[iplist.length-1]+'&properties=name='+range_name, "POST").then(function (objid) {
			if (objid.match("[a-z]")) {
				logError ("ERROR: bam: failed to add dhcp range: " + iplist + ": " + objid)
				return 0
			} else {

				if (debug) console.log ("DEBUG: bam(createVIPUser): successfuly added dhcp range("+objid+") for user: " + username)

				// Since we successfuly added a DHCP range, we now link it to the user tag 
				// and apply the mac pool deployment option as well
				bamobj.restCall('linkEntities', '?entity1Id='+userid+'&entity2Id='+objid, "PUT")
				if (debug) console.log ("DEBUG: bam(createVIPUser): deploying mac pool("+macpoolid+") on the dhcp range(" + objid +")")
				return bamobj.restCall('addDHCPServiceDeploymentOption', 
					'?entityId='+objid+'&name=allow-mac-pool&value=&properties=macPool='+macpoolid, "POST")
			}
		})
	})
}

function get_servers (bamobj, networkid, macpoolid) {
	return bamobj.restCall('getDeploymentRoles', '?entityId='+networkid).then(function(roles) {
		console.log ("DEBUG: bam(add_dhcp_range): deployment roles for network(" + networkid + "):" + roles) 

		if (!roles.length) {
			logError ("ERROR: bam: no deployment roles found")
			return 0
		} else {	
			var sids = []
			var dhcp_roles = roles.length

			return new Promise (function (resolve, reject) {
				for(var i=0; i<roles.length; i++) {
					var role = roles[i]
					if (role.service == "DHCP") {
						var id1 = role.serverInterfaceId
						var id2 = role.properties.match(/(.*)secondaryServerInterfaceId=([0-9]*)/)
						var propstr = ""
						if (id2) {
							id2 = id2[2]
							propstr += "secondaryServerInterfaceId=" + id2
						}

						if(debug) console.log ("DEBUG: bam(add_dhcp_range): found deployment role: " + JSON.stringify(role))
						if(debug) console.log ("DEBUG: bam(add_dhcp_range): deploying mac pool to deployment role: " + JSON.stringify(role))
						bamobj.restCall('addDHCPDeploymentRole', '?entityId='+macpoolid+
						'&serverInterfaceId='+role.serverInterfaceId+'&type=MASTER&properties='+propstr, "POST").then(function (){
						}, logError)

						bamobj.restCall('getServerForRole', '?roleId='+role.id).then(function (server) {
							console.log ("Servers are : " + JSON.stringify(server))
							sids.push(server.id)
							dhcp_roles--
							if (dhcp_roles == 0) {
								resolve(sids)
							}
						})
					} else {
						dhcp_roles--
					}
				}
			})
		}
	})
}

//////////////////////////////
// Adds a DHCP Range for a VIP user
// Links the newly created DHCP Range pool to the VIP user
// Dependency -->
//	This should be called only when a VIP user exists otherwise the linkage fails!
// Returns the DHCP object or 0 
/////////////////////////////
function del_and_add_new_dhcp_range (bamobj, username, userid, macpoolid, iplist) {

	if (!iplist.length) return 0

	if (debug) console.log ("DEBUG: bam(createVIPUser): adding a new dhcp range for user(" + username + ") :"  + iplist)
	// Get the container network id
	return bamobj.restCall('getIPRangedByIP', 
			'?containerId='+bamobj._configId+'&type=IP4Network&address='+iplist[0], "GET").then(function(network) {
		return get_servers (bamobj, network.id, macpoolid).then(function (sid) {

			var sids = unique(sid)
			console.log ("Got sid :" + sids)
			if (sids) {
				return del_add_and_link_dhcp (bamobj, username, userid, macpoolid, network.id, iplist).then(function (added) {
					if (added) {
						sids.forEach (function (sid) {
							bamobj.restCall('deployServerServices', '?serverId='+sid+'&services=services=DHCP', "POST")
						})
						return added
					} else {
						return 0
					}
				}, logError)
			} else {
				return 0
			}
		}, logError)
	}, logError)
}

//////////////////////////////
// This function is used to test if a DHCP overlap exists, this is used only by createVIPUser
// Returns an ERROR string if overlap exists.
// If return value is 1, then it means we are safe
/////////////////////////////
// Return ERROR string if an overlap exists
function try_dhcp_add (bamobj, username, iplist) {
	if (debug) console.log ('DEBUG: bam(try_dhcp_add): trying to add : ' + iplist)
	return bamobj.restCall('getIPRangedByIP', 
			'?containerId='+bamobj._configId+'&type=&address='+iplist[0], "GET").then(function(network) {

		if (network.type == 'DHCP4Range'){
			if (network.name == username+'-range') {
				return 1
			}
			else {
				return ('ERROR: dhcp range overlap detected: network')
			}
		} else {
			if (trace) console.log ("TRACE: bam (try_dhcp_add):  dhcp range is ok")
			return 1
		}
	})
	/*, function (err) {
		return err
	})*/
}

////////// END OF HELPER FUNCTIONS ////////////////////////////////////////

////////// CREATE VIP USER - USED BY THE UI ONLY /////////////////////////
//
// creates a VIP tag for the user
// creates a mac-pool associated with the users name
// creates a dhcp-range associated with the users name only if the iplist is present
// deletes any old dhcp-ranges for this user as well
//
//////////////////////////////////////////////////////////////////////////
bam.prototype.createVIPUser = function (args) {
	var self = this;
	var username = default_domain + "\\\\" + args[0]
	var iplist = []
	iplist.push(args[1])
	iplist.push(args[2])

	if (fixed_vip_assignment) {

		// First we check for a dhcp range overlap, if yes, we return an error
		// The best way to do this is to try a test addition to see if there is an existing overlap.
		// Get the container network id
		return try_dhcp_add (self, username, iplist).then(function (val) {
			if (val != 1) {
				return ("ERROR: dhcp range overlap detected.")
			} else {

			// Next we add the VIP, (gets an old id if it exists)
			return self.get(username, 'vipuser', "CREATE").then(function (userid) {
	
				if (debug) console.log ("DEBUG: bam(createVIPUser): sccuess in vip user: " + JSON.stringify(username))

				// Add the mac pool, creates a new one if it was not present already
				// This call also links the mac pool to the user
				return add_mac_pool(self, username, userid).then(function (macpoolid) {

					if (debug) console.log ("DEBUG: bam(createVIPUser): linked user: " + username + " with macpool id: " + macpoolid)
				
					// Delete the old DHCP range and add the new one
					// This call also links the created dhcp range to the user
					return del_and_add_new_dhcp_range(self, username, userid, macpoolid, iplist).then(function (dhcpid) {
						if (dhcpid) {
							if (debug) console.log ("DEBUG: bam(createVIPUser): linked user: " + username + " with dhcp range id: " + dhcpid)
							return userid
						} else return ('ERROR: failed to add a vip user')
					})
				})
			})
			}
		})

	} else {
		// add the VIP, (gets an old id if it exists)
		return self.get(username, 'vipuser', "CREATE").then(function (userid) {
			self.get(username, 'corpuser', 'DELETE')
			if (debug) console.log ("DEBUG: bam(createVIPUser): sccuess in vip user: " + JSON.stringify(username))
			return userid
		})
	}
}

////////// END OF CREATE VIP USER - USED BY THE UI ONLY /////////////////////////

////////// ACTUAL FUNCTIONS USED BY THE MIDDLEWARE - INLINE PROCESSING /////////////////////////////
bam.prototype.getMAC = function (mac) {
	var self = this
	var mac_obj = {}

	return self.restCall ('getMACAddress', '?configurationId='+self._configId+'&macAddress='+mac, "GET").then(function(obj) {
		mac_obj.macid = obj.id
		try {
			mac_obj.mac = obj.properties.split("address=")[1].split("|")[0]
			mac_obj.macpool = obj.properties.split("macPool=")[1].split("|")[0]
		} catch (err) {
			;		
		}
		return self.restCall ('getLinkedEntities', '?entityId='+obj.id+'&type=Tag&start=0&count=10', "GET").then(function(linkobj) {
			if (linkobj.length) {
				mac_obj.user = linkobj[0].name
				mac_obj.userid = linkobj[0].id
			}

			if (mac_obj.macpool && (mac_obj.macpool != self._macPoolName)) {
				return self.get (mac_obj.macpool, 'MACPool').then(function(poolid) {
					mac_obj.macpoolid = poolid
					return mac_obj
				})
			} else {
				if (mac_obj.macpool) mac_obj.macpoolid = self._macPoolId
				return mac_obj
			}
			
		}, function (err) {
			return mac_obj
		})

	}, function (err) {
		return self.restCall ('addMACAddress', '?configurationId='+self._configId + '&macAddress='+mac, "POST").then(function(new_macid) {
			if (debug) console.log ("Added a new mac : " + JSON.stringify(new_macid))
			mac_obj.macid = new_macid
			mac_obj.mac = mac
			return mac_obj
		}, logError)
	})
}

bam.prototype.linkMACToUser = function (macobj, userobj) {

	var self = this;
	var newuserid = userobj.userid

	if (debug) console.log ("DEBUG: bam(linkMACToUser): linking the mac " + macobj.mac + " to user " + userobj.username + "(" + userobj.userid + ")")
	// First we link the MAC address to this user Tag
	self.restCall ('linkEntities', '?entity1Id='+macobj.macid+'&entity2Id='+newuserid, "PUT")
	self.restCall ('linkEntities', '?entity1Id='+macobj.macid+'&entity2Id='+userobj.macpoolid, "PUT").then(function (done) {
		console.log ("Successfully linked: " + macobj.macid )
	}, function (err) {
		console.log ("Err: " + err + ":" + macobj.macid )
	})

	self.restCall ('linkEntities', '?entity1Id='+macobj.macid+'&entity2Id='+userobj.macpoolid, "PUT")
}

bam.prototype.unlinkMACFromUser = function (macobj, unlink_pool) {

	var self = this;

	if (debug) console.log ("DEBUG: bam(unlinkMACFromUser): unlinking mac " + macobj.mac + " from user " + macobj.user + "(" + macobj.userid + ")")
	// First we unlink the MAC address from the user Tag. No sequencing or error handling required
	self.restCall ('unlinkEntities', '?entity1Id='+macobj.macid+'&entity2Id='+macobj.userid, "PUT")

	if (unlink_pool) {
		self.restCall ('unlinkEntities', '?entity1Id='+macobj.macid+'&entity2Id='+macobj.macpoolid, "PUT")
	}
}

// This call returns the active IP address for a MAC address.
// used by pingtest.
bam.prototype.getIPForMAC = function (macid) {
	var self = this
	return self.restCall ('getLinkedEntities', '?entityId='+macid+'&type=IP4Address&start=0&count=10', "GET").then(function(ipobjs) {
		ip = JSON.stringify(ipobjs).match(/address=([0-9]+.[0-9]+.[0-9]+.[0-9]+)\|state=DHCP_ALLOCATED/)
		if (ip && ip[1]) {
			return ip[1]
		} else {
			return 0
		}
	}, function () {
		return 0
	})
}

bam.prototype.getUserLinkages = function (obj, type) {
	var self = this

	// If fixed vip assignments are turned off, we don't return any MACPool or DHCP4Range linkages
	if ((!fixed_vip_assignment) && 
		(type == 'DHCP4Range') || (type == 'MACPool')) {
		return obj
	} else {
		if (debug) console.log ("TRACE: bam: getting objects of type " + type + " from: " + obj.username)
        	// Get linked entities here MACS / DHCP Ranges.
        	return self.restCall ('getLinkedEntities', '?entityId='+obj.userid+'&type='+type+'&start=0&count=10', "GET")
        	.then (function (entities) {
        		for (var i=0; i<entities.length; i++) {
				if (type == 'MACAddress') {
					var str = entities[i].properties.split('macPool=')[1]
					if (str) {
        					macpool = str.split('|')[0]
					} 
        				macaddress = entities[i].properties.split('|')[0].split('=')[1]
        				obj.devices.push( { 'mac': macaddress, 'macid': entities[i].id, 'macpool': macpool } )
				}
				if (type == 'DHCP4Range') {
					obj.ranges.push({'rangeid': entities[i].id})
				}
				if (type == 'MACPool') {
					obj.macpool = entities[i].name
					obj.macpoolid = entities[i].id
				}
        		}
			return obj
        	})
	}
}

// Objective is to build a proper JSON object with all the data we need.
// PS: This function automatically creates a corporate user if the user is not in the VIP tag
// {
//	user: 'tim',
//	type: 'vip | corporate',
//	present: 1,
//	userid: 12923,
//	limit: 3,
//	devices: [ { 'mac': 'aa-bb', 'macid': '1234', 'ip' : 'xxxx' }, {'mac': 'aa-cc', 'macid': '1234', 'ip': 'yyyy'} ]
// }

//PS: This automatically creates a corp user, should be used with caution
bam.prototype.getUser = function (user) {

	var self = this
	var obj = {}
	obj.devices = []
	obj.ranges = []

	obj.username = user
	return self.get(user, 'vipuser').then(function (userid) {
		if (userid) {
			if (trace) console.log ('TRACE: found a vipuser: ' + userid)
			set_user_type (self, obj, 'vip', userid)
			if (trace) console.log ("TRACE: getting user linkages")
			return Q.all ([
				self.getUserLinkages (obj, "MACAddress"),
				self.getUserLinkages (obj, "MACPool"),
				self.getUserLinkages (obj, "DHCP4Range")
			]).then(function (res1, res2, res3) {
				console.log ("Completed getting linkages for  VIP user")
				return obj
			})
		} else {

			// Add this as a corporate user 
			return self.get(user, 'corpuser', "CREATE").then (function (userid) {
				if (trace) console.log ('TRACE: found a corpuser: ' + userid)
				set_user_type (self, obj, 'corp', userid)
				return self.getUserLinkages (obj, "MACAddress")
			})
		}
	})
}

////////// END OF ACTUAL FUNCTIONS USED BY THE MIDDLEWARE - INLINE PROCESSING /////////////////////////////
module.exports = bam
