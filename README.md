# identity-bridge
Simple integration tying together Cisco ISE, Palo Alto and BlueCat to identify users by assigned IP address.

The BlueCat Identity Bridge consists of two components:
- A webserver running on port(5000) by default
- A NodeJS service listening for incoming syslog messages on UDP Port 514

# Installation
Pre-Requisite: NodeJS & npm need to be installed and running on the target system.
Run the following command to start the service
`node setup.js`

# Settings
All settings are stored in settings.json
