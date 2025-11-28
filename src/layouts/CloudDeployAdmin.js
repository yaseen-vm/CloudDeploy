import React from "react";
import { useLocation, Route, Switch } from "react-router-dom";

import routes from "../routes.js";

function CloudDeployAdmin() {
  const [color, setColor] = React.useState("blue");
  const location = useLocation();
  const mainPanel = React.useRef(null);
  
  const getRoutes = (routes) => {
    return routes.map((prop, key) => {
      if (prop.layout === "/admin") {
        return (
          <Route
            path={prop.layout + prop.path}
            render={(props) => <prop.component {...props} />}
            key={key}
          />
        );
      } else {
        return null;
      }
    });
  };

  React.useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.scrollingElement.scrollTop = 0;
    mainPanel.current.scrollTop = 0;
  }, [location]);

  return (
    <>
      <div className="wrapper">
        <div className="main-panel" ref={mainPanel}>
          <div className="content">
            <Switch>{getRoutes(routes)}</Switch>
          </div>
        </div>
      </div>
    </>
  );
}

export default CloudDeployAdmin;