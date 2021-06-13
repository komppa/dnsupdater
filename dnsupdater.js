const winston = require('winston')
const fetch = require('node-fetch')
require('dotenv').config()
const ovh = require('ovh')({
    appKey: process.env.DNSU_APP_KEY,
    appSecret: process.env.DNSU_APP_SECRET,
    consumerKey: process.env.DNSU_CONSUMER_KEY
})

var ipServices = [
    "https://ifconfig.me/all.json",
    "https://ifconfig.co/json"
]

var domain = process.env.DNSU_DOMAIN
var subDomain = process.env.DNSU_SUBDOMAIN
var domainTtl = process.env.DNSU_SUBDOMAIN_TTL


var recordId = 0
var currentLocalAddress = ""
var currentOvhAddress = ""



/* LOGGER */

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'log.log' }),
  ],
});

const inf = (msg) => {
    logger.log({
        level: "info", 
        message: msg
    })
}

const err = (err) => {
    logger.log({
        level: "error",
        message: err
    })
}



/**
 * Check if domain exists on the user end.
 * @async
 * @param {string} domain - domain name that has the wanted subdomain 
 * @returns {Promise<bool>} - Promise object represent the value if user owns the specific domain
 */

const domainExists = async (domain) => {

    // OVH returns array of strings that contains the owned domain names
    return new Promise(async(res, rej) => {
        await ovh.request('GET', '/domain/zone/', (err, req) => {
            if (req.includes(domain)) {
                res(true)
            } else {
                res(false)
            }
        })
    })

}

/**
 * Get DNS record IDs that specific domain name have
 * @async
 * @param {string} domain - domain name whose DNS record IDs is wanted
 * @returns {Promise<Array<number>>} - Promise object represents the array of numbers - DNS records' IDs
 */
const getDnsRecordIds = async (domain) => {

    // OVH returns a list of numbers and each number in a list 
    // represents the ID of the one subdomain record
    return new Promise((res, rej) => {
        ovh.request('GET', '/domain/zone/' + domain + '/record', (err, req) => {
            res(req)
        })
    })

}


/**
 * @typedef {Object} DNSRecord
 * @property {string} target Where subdomain points to 
 * @property {number} id Rrecord's ID 
 * @property {string} zone Domain name 
 * @property {string} subDomain Subdomain's value (f.ex. www) 
 * @property {string} ttl Record's Time To Live 
 */

/**
 * Get record's details. 
 * @param {number} id - ID of the DNS record 
 * @returns {Promise<DNSRecord>} Promise object represents the record detail object
 */
const getDnsRecordDetailsById = async (domain, id) => {

    return new Promise((res, rej) => {
        ovh.request('GET', '/domain/zone/' + domain + '/record/' + id, (err, req) => {
            console.log("err", err)
            res(req)
        }); 
    })

}

/**
 * Updates DNS record.
 * @async
 * @param {number} id - DNS record's ID 
 * @param {string} subDomain - name of the subdomain that will be updated 
 * @param {string} target - Target address 
 * @param {number} ttl - Record's Time To Live  
 */
const updateDnsRecord = async (id, subDomain, target, ttl) => {

    inf("@updateDnsRecord: id: " + id + ", subDomain: " + subDomain + ", target: " + target + ", ttl: " + ttl)
 
    ovh.request('PUT', '/domain/zone/' + domain + '/record/' + id, {
        "subDomain": subDomain,
        "target": target,
        "ttl": ttl
    }, (err, req) => {
        if (err) {
            err("Couldn't update the DNS record", err)
            res(false)
        }
        
        console.log(req)
        res(true)
    }) 

}

/**
 * Get current IP address using IP resolver service.
 * @async
 * @param {string} addr - IP service's address 
 * @returns {Promise<Object>} Object that contains current IP address (key is ip or ip_addr)
 */
const fetchIp = async (addr) => {

    return new Promise((res, rej) => {
        fetch(addr)
            .then(response => {
                if (response.status !== 200) {
                    return false
                }
                return response.json()
            })
            
            .then(result => {
                
                if (!result) {
                    err("IP service " + addr + " didn't return statuscode 200")
                    res(false)
                } else {
                    res(result)
                }
            })
            .catch(error => { 
                console.log("CONNECTION BROKEN", error)
                res(false) 
            })
    })

}

/**
 * Validate that IPv4 address is in the correct format.
 * @async
 * @param {string} addr - IPv4 address
 * @returns {bool} Status whether the IPv4 address is in the correct format
 */
const validateIp4Address = (addr) => {
    if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(addr)) {
        return true
    }

    return false
}

/**
 * Get current address using some of the IP resolving services. 
 * Uses backup services if needed and in the end validates the received address. 
 * @returns {Promise<string>} Promise object represents the current address
 */
const getCurrentLocalAddress = async () => {

    return new Promise( async(res, rej) => {

        // Get current IP address for this server

        let response
        for (let i = 0; i < ipServices.length; i++) {
            response = await fetchIp(ipServices[i])            

            if (response) {
                // Is address encapsulated in JSON as 'ip' or 'ip_addr' key
                response = response.ip === undefined ? response.ip_addr : response.ip

                // Check if returned IP was really valid address
                if (validateIp4Address(response)) {
                    res(response)
                    break
                }
            } else {
                res(false)
            }
        }


    })

}

/**
 * Startup script. Fetches current target for the subdomain and compaires it against 
 * current address from the IP resolver service.
 * @async  
 */
const startup = async () => {

    let ids = []
    let details = {}
    let ip = ""
    let primarySourceFailed = false


    let domain_exist = await domainExists(domain)
    
    if (domain_exist) {

        ids = await getDnsRecordIds(domain)
        
        for (id in ids) {
            details = await getDnsRecordDetailsById(ids[id])
            if (details.subDomain === subDomain) {
                recordId = details.id
                currentOvhAddress = details.target
                break // Don't continue, you already found correct details field
            }
        }

        currentLocalAddress = await getCurrentLocalAddress()

        // Check if OVH and you have different addresses at startup - if yes, update your address to DNS record
        if  (currentLocalAddress != currentOvhAddress) {
            inf("OVH returned (" + currentOvhAddress + ") different address that you (" + currentLocalAddress + ") currently have - updating it to the OVH")
            
            let updateStatus = await updateDnsRecord(recordId, subDomain, currentLocalAddress, domainTtl)
            if (updateStatus) {
                inf("DNS record update function returned success")
            } else {
                err("DNS record update function returned FAILURE")
            }

            // Waiting for 10 sec to ensure that updating request has reached its destination
            inf("Waiting for 10 sec to ensure that updating request has reached its destination")
            setTimeout(async () => {
                // Check if updating worked and OVH has now new address
                let checkDetails = await getDnsRecordDetailsById(recordId)
                if (currentLocalAddress === checkDetails.target) {
                    inf("Double checking if DNS record was updated succcessfully: SUCCESS")
                } else {
                    err("Double checking if DNS record was updated succcessfully: FAILURE - DNS record: '" + currentOvhAddress + "' and Local address: '" + currentLocalAddress +"'")
                    return
                }
            }, 3000)

            

        } else {
            inf("Your current IP (" + currentLocalAddress + ") and DNS record's addresses (" + currentOvhAddress + ") are the same - no action at startup")
        }
        
    } else {
        err("There is no domain '" + domain + "' that you own")
    }

    loop()

}


let i = 0
/**
 * Loop checking whether address of the current machine has been changed.
 * @async
 */
const loop = async () => {

    let receivedAddress = await getCurrentLocalAddress()

    if (receivedAddress) {
        inf("At loop, fetched new ip address succesfully, new address is " + receivedAddress + " when last time it was " + currentLocalAddress + ". Addresses can be the same")
        
        // Check if addresses were different
        if (receivedAddress !== currentLocalAddress) {
            currentLocalAddress = receivedAddress
            console.log("UPDATING DNS RECORD")
            updateDnsRecord(recordId, subDomain, currentLocalAddress, 300)
            inf("@loop: Addresses were different, received IP " + receivedAddress + " when IP was last time (localip) is " + currentLocalAddress)
        } else {
            inf("@loop: Addresses were the same at " + new Date() + " received IP "+ receivedAddress + " when IP was last time (localip) is " + currentLocalAddress)
        }

    } else {
        err(new Date() + " connection problem, loop couldn't getch new IP")
    }

    i = i + 1

    setTimeout(() => {
        loop()
    }, process.env.DNSU_CHECKING_INTERVAL)
    
}


inf("Updater V2 started at " + new Date() + " and it's updating subdomain '" + subDomain + "' for domain '" + domain + "'")
startup()
