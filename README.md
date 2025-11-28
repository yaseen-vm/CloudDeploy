# CloudDeploy - Docker PaaS Platform

![version](https://img.shields.io/badge/version-1.0.0-blue.svg) ![license](https://img.shields.io/badge/license-MIT-blue.svg)

**CloudDeploy** is a simple Platform-as-a-Service that lets users deploy Dockerfiles and get live URLs instantly. Built with React and Node.js, it provides a beautiful dashboard interface for managing your containerized applications.

## Table of Contents

- [Demo](#demo)
- [Quick Start](#quick-start)
- [Features](#features)
- [API Endpoints](#api-endpoints)
- [File Structure](#file-structure)
- [Development](#development)
- [Deployment](#deployment)
- [Browser Support](#browser-support)
- [Contributing](#contributing)
- [License](#license)

## Demo

| Dashboard | Deployments | Upload |
| --------- | ----------- | ------ |
| Main dashboard with deployment overview | List and manage all deployments | Upload Dockerfile interface |

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Node.js 16+ (for development)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd paas

# Start the platform
docker-compose up -d

# Visit http://localhost
# Upload a Dockerfile
# Get a live URL for your app
```

### Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build
```

## Features

- 🚀 **Instant Deployment** - Upload Dockerfile and get live URL
- 📊 **Dashboard Interface** - Beautiful React-based admin panel
- 🐳 **Docker Integration** - Full Docker container management
- 🔄 **Real-time Updates** - Live deployment status
- 📱 **Responsive Design** - Works on all devices
- 🎨 **Multiple Themes** - Customizable sidebar colors

## API Endpoints

### Deployment Management
- `POST /deploy` - Upload Dockerfile, returns deployment URL
- `GET /deployments` - List all active deployments
- `GET /deploy/:id` - Get specific deployment details
- `DELETE /deploy/:id` - Remove deployment
- `PUT /deploy/:id` - Update deployment configuration

### System
- `GET /health` - System health check
- `GET /stats` - Platform statistics

## File Structure

```
cloudeploy/
├── README.md
├── docker-compose.yml
├── Dockerfile
├── package.json
├── server.js
├── nginx.conf
├── public/
│   └── index.html
├── deployments/
├── light-bootstrap-dashboard-react-master/
│   └── light-bootstrap-dashboard-react-master/
│       ├── public/
│       ├── src/
│       │   ├── components/
│       │   ├── views/
│       │   ├── layouts/
│       │   └── assets/
│       └── package.json
└── .dockerignore
```

## Development

### Frontend (React Dashboard)

```bash
cd light-bootstrap-dashboard-react-master/light-bootstrap-dashboard-react-master
npm install
npm start
```

### Backend (Node.js API)

```bash
npm install
node server.js
```

### Docker Development

```bash
# Build and run with Docker
docker-compose up --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Deployment

### Production Deployment

```bash
# Build production images
docker-compose -f docker-compose.prod.yml up -d

# Or deploy to cloud provider
# Configure your cloud deployment here
```

### Environment Variables

```bash
PORT=3000
DOCKER_HOST=unix:///var/run/docker.sock
BASE_URL=http://localhost
STARTING_PORT=4000
```

## Browser Support

CloudDeploy supports the last two versions of:

- Chrome
- Firefox 
- Safari
- Edge
- Opera

## Example Usage

1. **Create a Dockerfile**
   ```dockerfile
   FROM node:16-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm install
   COPY . .
   EXPOSE 3000
   CMD ["npm", "start"]
   ```

2. **Upload via Web Interface**
   - Visit the CloudDeploy dashboard
   - Click "New Deployment"
   - Upload your Dockerfile
   - Configure deployment settings

3. **Get Live URL**
   - Receive instant URL like `http://localhost:4001`
   - Monitor deployment status
   - Access your live application

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions:
- Create an issue on GitHub
- Check the documentation
- Contact the development team

---

**CloudDeploy** - Making container deployment simple and beautiful.