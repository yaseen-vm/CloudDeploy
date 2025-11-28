const { spawn } = require('child_process');

// Test Cloudflare tunnel creation
async function testTunnel() {
  console.log('Testing Cloudflare tunnel...');
  
  const tunnelProcess = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3000', '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let output = '';
  
  tunnelProcess.stdout.on('data', (data) => {
    output += data.toString();
    console.log('STDOUT:', data.toString());
    
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      console.log('✅ Tunnel URL found:', match[0]);
      tunnelProcess.kill();
      process.exit(0);
    }
  });
  
  tunnelProcess.stderr.on('data', (data) => {
    console.log('STDERR:', data.toString());
  });
  
  tunnelProcess.on('error', (error) => {
    console.error('❌ Process error:', error);
    process.exit(1);
  });
  
  setTimeout(() => {
    console.log('❌ Timeout - no tunnel URL found');
    tunnelProcess.kill();
    process.exit(1);
  }, 10000);
}

testTunnel();