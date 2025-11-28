# VM Deployment Guide for CloudDeploy

## ✅ Issues Fixed

All critical issues have been resolved to ensure smooth deployment in VM environments:

### 🔧 Critical Fixes Applied

1. **✅ MySQL Connection Reliability**
   - Implemented exponential backoff retry logic (10 retries)
   - Added connection testing before proceeding
   - Graceful degradation if database unavailable
   - Better error logging with emojis for visibility

2. **✅ Directory Creation**
   - Automatic creation of `uploads/` and `deployments/` directories
   - Prevents ENOENT errors on file operations
   - Recursive directory creation for nested paths

3. **✅ Port Conflict Prevention**
   - Port tracking with `usedPorts` Set
   - Automatic conflict detection and retry
   - Prevents "address already in use" errors

4. **✅ Cloudflared Architecture Detection**
   - Automatic detection of AMD64 vs ARM64
   - Downloads correct binary for VM architecture
   - Prevents "exec format error" on ARM-based VMs

5. **✅ MySQL Health Check**
   - Docker Compose now waits for MySQL to be ready
   - Eliminates race conditions on startup
   - 30-second start period with 10 retries

6. **✅ WebSocket Protocol Detection**
   - Auto-detects HTTP vs HTTPS
   - Uses correct ws:// or wss:// protocol
   - Works across different domains and IPs

7. **✅ Build Directory Fix**
   - Git clones now use persistent directory
   - Changed from `/tmp/` to `./deployments/`
   - Prevents permission issues in containers

8. **✅ Resource Limits**
   - MySQL: 512MB limit, 256MB reservation
   - CloudDeploy: 1GB limit, 512MB reservation
   - Prevents resource exhaustion in VMs

9. **✅ UI Fix**
   - Removed duplicate CloudDeploy header
   - Cleaner, more professional interface

## 🚀 VM Deployment Instructions

### Prerequisites

1. **VM Requirements**
   - OS: Ubuntu 20.04+ / Debian 11+ / CentOS 8+
   - RAM: Minimum 2GB (4GB+ recommended)
   - Disk: Minimum 20GB free space
   - CPU: 2+ cores recommended

2. **Software Requirements**
   ```bash
   # Install Docker
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   
   # Install Docker Compose
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   
   # Verify installations
   docker --version
   docker-compose --version
   ```

### Deployment Steps

1. **Clone the Repository**
   ```bash
   git clone <your-repo-url>
   cd paas
   ```

2. **Configure Firewall (if needed)**
   ```bash
   # For Ubuntu/Debian with UFW
   sudo ufw allow 3001/tcp    # CloudDeploy dashboard
   sudo ufw allow 5000:5100/tcp  # Deployment ports
   
   # For CentOS/RHEL with firewalld
   sudo firewall-cmd --permanent --add-port=3001/tcp
   sudo firewall-cmd --permanent --add-port=5000-5100/tcp
   sudo firewall-cmd --reload
   ```

3. **Start the Application**
   ```bash
   # Build and start services
   docker-compose up -d --build
   
   # Check logs
   docker-compose logs -f
   ```

4. **Verify Deployment**
   ```bash
   # Check service status
   docker-compose ps
   
   # Should show both mysql and clouddeploy as "Up"
   ```

5. **Access Dashboard**
   - Open browser: `http://<VM_IP>:3001`
   - You should see the CloudDeploy dashboard
   - WebSocket status should show "Connected" (green)

### Post-Deployment Checks

1. **Test Database Connection**
   ```bash
   docker-compose logs clouddeploy | grep "Database"
   # Should see: ✅ Database connected successfully
   ```

2. **Test Cloudflared Installation**
   ```bash
   docker-compose exec clouddeploy cloudflared --version
   # Should display version number
   ```

3. **Test Deployment**
   - Use the "Test Deployment" button in the dashboard
   - Should deploy nginx and create a Cloudflare tunnel
   - Verify you get a public URL

## 🔍 Troubleshooting

### Issue: MySQL Connection Fails

**Symptoms:** Logs show "Database connection failed" repeatedly

**Solutions:**
```bash
# Check MySQL is running
docker-compose ps mysql

# Check MySQL logs
docker-compose logs mysql

# Restart services
docker-compose restart
```

### Issue: Docker Socket Permission Denied

**Symptoms:** "Error: connect EACCES /var/run/docker.sock"

**Solutions:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Or run with sudo
sudo docker-compose up -d
```

### Issue: Cloudflared Not Working

**Symptoms:** Tunnels fail to create, deployments show localhost URLs only

**Solutions:**
```bash
# Check cloudflared installation
docker-compose exec clouddeploy which cloudflared
docker-compose exec clouddeploy cloudflared --version

# Check logs for tunnel errors
docker-compose logs clouddeploy | grep -i tunnel

# Tunnels are optional - app works with localhost URLs
```

### Issue: Port Already in Use

**Symptoms:** "Error: bind: address already in use"

**Solutions:**
```bash
# Check what's using port 3001
sudo lsof -i :3001
sudo netstat -tulpn | grep 3001

# Change port in docker-compose.yml
# Change "3001:3000" to "8080:3000" or any available port
```

### Issue: Out of Disk Space

**Symptoms:** Deployments fail, "no space left on device"

**Solutions:**
```bash
# Clean up Docker
docker system prune -a --volumes

# Check disk usage
df -h
docker system df

# Remove old deployments from dashboard
```

## 📊 Monitoring

### View Logs
```bash
# All services
docker-compose logs -f

# CloudDeploy only
docker-compose logs -f clouddeploy

# MySQL only
docker-compose logs -f mysql

# Last 100 lines
docker-compose logs --tail=100
```

### Resource Usage
```bash
# Container stats
docker stats

# Disk usage
docker system df
```

## 🔄 Maintenance

### Update Application
```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

### Backup Database
```bash
# Backup MySQL data
docker-compose exec mysql mysqldump -u clouddeploy -ppassword clouddeploy > backup.sql

# Restore
docker-compose exec -T mysql mysql -u clouddeploy -ppassword clouddeploy < backup.sql
```

### Clean Up Old Deployments
```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune
```

## 🔒 Security Recommendations

1. **Change Default Passwords**
   ```yaml
   # In docker-compose.yml, change:
   MYSQL_ROOT_PASSWORD: <strong-password>
   MYSQL_PASSWORD: <strong-password>
   ```

2. **Enable Firewall**
   ```bash
   # Only allow necessary ports
   sudo ufw enable
   sudo ufw default deny incoming
   sudo ufw allow ssh
   sudo ufw allow 3001/tcp
   ```

3. **Use HTTPS**
   - Set up nginx reverse proxy with SSL
   - Use Let's Encrypt for free certificates
   - Configure in front of CloudDeploy

4. **Limit Resource Usage**
   - Resource limits already configured in docker-compose.yml
   - Monitor with `docker stats`

## 📝 Environment Variables

You can customize these in `docker-compose.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | mysql | MySQL hostname |
| `DB_USER` | clouddeploy | MySQL username |
| `DB_PASSWORD` | password | MySQL password |
| `DB_NAME` | clouddeploy | MySQL database name |
| `CLOUDFLARE_ENABLED` | true | Enable Cloudflare tunnels |
| `STARTING_PORT` | 5000 | Starting port for deployments |
| `NODE_ENV` | production | Node environment |

## ✨ What's New

- ✅ Exponential backoff for database connections
- ✅ Automatic directory creation
- ✅ Port conflict detection
- ✅ Multi-architecture support (AMD64/ARM64)
- ✅ MySQL health checks
- ✅ Resource limits to prevent VM overload
- ✅ WebSocket protocol auto-detection
- ✅ Improved error messages with emojis
- ✅ Persistent build directories

## 🎯 Next Steps

1. Deploy to your VM using the instructions above
2. Test with a simple deployment (use "Test Deployment" button)
3. Monitor logs for any issues
4. Configure firewall and security settings
5. Set up backups for MySQL data

## 💡 Tips

- **Start small**: Test with the nginx test deployment first
- **Monitor resources**: Use `docker stats` to watch memory/CPU
- **Check logs**: Always check logs if something doesn't work
- **Cloudflare tunnels**: Optional but provide free public URLs
- **Localhost works**: Even without tunnels, localhost URLs work fine

## 📞 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review logs: `docker-compose logs -f`
3. Verify all prerequisites are met
4. Check GitHub issues for similar problems

---

**CloudDeploy** - Now VM-ready! 🚀
