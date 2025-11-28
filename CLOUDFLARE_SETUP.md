# Cloudflare Tunnel Setup

CloudDeploy now automatically creates free public URLs using Cloudflare tunnels instead of localhost URLs.

## How it works

1. When you deploy an application, CloudDeploy automatically creates a Cloudflare tunnel
2. You get a free public URL like `https://abc123.trycloudflare.com`
3. No configuration needed - it works out of the box

## Environment Variables

- `CLOUDFLARE_ENABLED=true` - Enable Cloudflare tunnels (default: enabled in docker-compose)

## Features

- ✅ Free public URLs
- ✅ HTTPS by default
- ✅ No domain registration required
- ✅ Automatic tunnel cleanup on deployment deletion
- ✅ Fallback to localhost if tunnel fails

## Example URLs

Instead of: `http://localhost:5001`
You get: `https://abc123-def456.trycloudflare.com`

## Troubleshooting

If tunnels fail to create:
1. Check Docker logs: `docker-compose logs clouddeploy`
2. Test tunnel manually: `node test-tunnel.js`
3. Verify cloudflared is installed in container