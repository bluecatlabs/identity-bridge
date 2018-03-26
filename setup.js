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
