
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

var package = require ('./package.json')
var exec = require('child_process').execSync

console.log ("Installing dependencies....")
keys = Object.keys(package.dependencies)

for (var i=0; i<keys.length; i++) {
        key = keys[i]
        value = package.dependencies[key]

        if (!value)
        {
                try {
                        console.log ("installing " + key)
                        cmd = 'sudo npm install '
                        exec (cmd + key)
                        package = require ('./package.json')
                } catch (err) {
                        console.log ("Failed to install " + key)
                        console.log ("Exiting setup")
                }
        } else {
                console.log (key + " version " + value + " exists")
        }
}

startServer()

function startServer () {
        console.log ("Finished installing dependencies.")
        console.log ("Starting middleware web services...")
        try {
                exec ("sudo ./node_modules/forever/bin/forever -s stop webserver.js")
        } catch (err) {
        }
        exec ("sudo ./node_modules/forever/bin/forever -al /var/log/middleware.log start webserver.js")
}
