# DNSUpdater

DNSUpdater is dynamic DNS updater that updates the DNS record using OVH API. Currently project allows only subdomains to be updated when the address of the network changes. Change of the IP address is recognized by polling one of the "What is my IP address"-services. There is also another one for the backup. 


## Getting started

1. Create OVH API keys (it's recommend not to give too much permissions for the script)
2. Paste your keys to the .env file. App key, app secret and consumer key is required script to run properly.
3. Write your domain name with the top-level domain to the .env file and write the subdomain that you want to be updated using the running machines address.
4. Make sure that the checking interval is suitable for your purpose. Note that the value is in milliseconds