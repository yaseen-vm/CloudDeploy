const fs = require('fs');

let content = fs.readFileSync('d:\\paas\\server.js', 'utf8');

// Replace all occurrences
content = content.replace(/createCloudflaredTunnel/g, 'createPublicTunnel');
content = content.replace(/tunnelProcess\.kill\(\)/g, 'tunnel.close()');
content = content.replace(/Kill Cloudflare tunnel/g, 'Close tunnel');

fs.writeFileSync('d:\\paas\\server.js', content);
console.log('Updated all tunnel references');