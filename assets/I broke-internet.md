# Case Study: Recovering from a Kernel-Level WireGuard Routing Blackhole

## Incident Overview
On September 18, 2026, all internet connectivity on a macOS machine was abruptly and completely severed upon reboot. Browsers failed to load, terminal pings timed out, and DNS resolution collapsed. The incident occurred during a backend migration of a custom dual-engine web browser (RAW Browser) from WireGuard to VLESS+REALITY.

## Technical Root Cause
The core issue was a catastrophic desynchronization between a local macOS background daemon and the remote server state.

1. **The Ghost Daemon:** When WireGuard was originally installed, a macOS Launch Daemon (`com.raw.wireguard.plist`) was configured to automatically establish the VPN tunnel (`wg-quick up wg0`) in the background every time the system booted up.
2. **The Server Purge:** During the migration, the WireGuard server on the Azure VPS (a 1GB RAM instance) was completely purged to free up system memory for the new VLESS engine.
3. **The Boot Blackhole:** The user restarted their MacBook. The moment macOS booted, the hidden launch daemon triggered and aggressively hijacked the system's entire routing table using WireGuard's `AllowedIPs = 0.0.0.0/0`. Because the remote Azure server was dead, the Mac started indiscriminately throwing 100% of the device's internet traffic into a dead digital black hole.
4. **The Panic Trigger:** The user logged in to find the internet completely severed. Unaware the daemon was already running, they manually executed `sudo wg-quick up ./wg0.conf` in the terminal to "fix" it. This only locked the dead static routes in further.

## The Recovery (Step-by-Step Analysis)
The user executed a brilliant, multi-stage Unix networking recovery to regain control of their machine.

### Phase 1: Attempted Graceful Teardown
```bash
sudo wg-quick down ./wg0.conf
```
The user first attempted to shut down the interface gracefully. However, because the configuration files were actively being deleted/modified, `wg-quick` lost track of the interface and threw `wg-quick: 'wg0' is not a WireGuard interface`. The system was permanently trapped with a dead static route.

### Phase 2: Kernel Routing Flush
```bash
sudo route flush
sudo route add default 192.168.1.1
```
Recognizing the kernel routing table was hijacked, the user used the BSD `route` command to completely wipe the static routing table (`route flush`) and manually attempted to reinstate the local home router (`192.168.1.1`) as the default gateway.

### Phase 3: Hardware Interface Bounce
```bash
sudo ifconfig en0 down && sleep 2 && sudo ifconfig en0 up
```
To ensure the Mac's networking daemon (mDNSResponder/configd) picked up the fresh routing table, the user performed a hard bounce of the physical Wi-Fi hardware interface (`en0`). This forced the OS to request a new DHCP lease and rebuild the basic local network stack.

### Phase 4: DNS Stack Rebuild
```bash
ping -c 3 8.8.8.8
sudo networksetup -setdnsservers "Wi-Fi" 8.8.8.8 1.1.1.1
```
The user successfully pinged Google's `8.8.8.8` IP directly, proving that raw IP connectivity was restored. However, websites still wouldn't load because WireGuard had hijacked the system's DNS resolvers. The user utilized the macOS-specific `networksetup` utility to forcefully rewrite the system DNS records back to Google (`8.8.8.8`) and Cloudflare (`1.1.1.1`). 

**Result:** Full internet connectivity was restored.

## Lessons Learned & Architectural Changes
This incident perfectly highlights the dangers of **Kernel-level VPNs** (like WireGuard/IPsec) for application-specific tunneling. Because they operate at the OS kernel level, a rogue background daemon or a single configuration mismatch can completely destroy the host machine's internet access.

**The Solution:** 
For the browser's built-in VPN, the architecture is migrating from WireGuard to **VLESS+REALITY (Xray)**. Unlike WireGuard, Xray operates purely in "user-space" as a local SOCKS5 proxy (port 10808). It only intercepts traffic that is explicitly handed to it by the browser application. It cannot physically alter the macOS kernel routing table, making this specific "routing blackhole" scenario completely impossible in the future.
