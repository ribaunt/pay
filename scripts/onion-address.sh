#!/bin/sh
# Print the .onion address for the optional Tor profile.
set -eu

docker exec pay-tor-1 cat /var/lib/tor/hidden_service/hostname
