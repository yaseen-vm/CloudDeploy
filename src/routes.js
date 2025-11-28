import CloudDeployDashboard from "views/CloudDeployDashboard.js";
import DeploymentUpload from "views/DeploymentUpload.js";

const cloudDeployRoutes = [
  {
    path: "/dashboard",
    name: "Dashboard",
    icon: "nc-icon nc-chart-pie-35",
    component: CloudDeployDashboard,
    layout: "/admin"
  },
  {
    path: "/deploy",
    name: "Deploy App",
    icon: "nc-icon nc-cloud-upload-94",
    component: DeploymentUpload,
    layout: "/admin"
  },
  {
    path: "/deployments",
    name: "Deployments",
    icon: "nc-icon nc-spaceship",
    component: CloudDeployDashboard,
    layout: "/admin"
  }
];

export default cloudDeployRoutes;