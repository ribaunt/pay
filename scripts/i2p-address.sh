#!/bin/sh
# Print the I2P b32 address for the optional i2p-only profile.
set -eu

docker exec pay-i2pd-1 sh -c 'cat /home/i2pd/data/pay.b32.i2p 2>/dev/null || ls /home/i2pd/data/*.b32.i2p 2>/dev/null | head -1 | xargs cat'
