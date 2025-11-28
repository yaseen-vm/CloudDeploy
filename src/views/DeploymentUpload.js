import React, { useState } from "react";
import {
  Button,
  Card,
  Form,
  Container,
  Row,
  Col,
  Alert,
  ProgressBar,
} from "react-bootstrap";

function DeploymentUpload() {
  const [file, setFile] = useState(null);
  const [appName, setAppName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [alert, setAlert] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !appName) {
      setAlert({ type: "danger", message: "Please provide both app name and Dockerfile" });
      return;
    }

    setUploading(true);
    setProgress(0);

    // Simulate upload progress
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setUploading(false);
          setAlert({ type: "success", message: "Deployment successful! Your app is available at http://localhost:4001" });
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  return (
    <>
      <Container fluid>
        <Row>
          <Col md="8" className="mx-auto">
            <Card>
              <Card.Header>
                <Card.Title as="h4">Deploy New Application</Card.Title>
                <p className="card-category">Upload your Dockerfile to deploy instantly</p>
              </Card.Header>
              <Card.Body>
                {alert && (
                  <Alert variant={alert.type} onClose={() => setAlert(null)} dismissible>
                    {alert.message}
                  </Alert>
                )}
                
                <Form onSubmit={handleSubmit}>
                  <Row>
                    <Col md="12">
                      <Form.Group>
                        <Form.Label>Application Name</Form.Label>
                        <Form.Control
                          type="text"
                          placeholder="Enter application name"
                          value={appName}
                          onChange={(e) => setAppName(e.target.value)}
                          disabled={uploading}
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                  
                  <Row>
                    <Col md="12">
                      <Form.Group>
                        <Form.Label>Dockerfile</Form.Label>
                        <Form.Control
                          type="file"
                          accept=".dockerfile,Dockerfile"
                          onChange={handleFileChange}
                          disabled={uploading}
                        />
                        <Form.Text className="text-muted">
                          Upload your Dockerfile to deploy your application
                        </Form.Text>
                      </Form.Group>
                    </Col>
                  </Row>

                  {uploading && (
                    <Row>
                      <Col md="12">
                        <Form.Group>
                          <Form.Label>Deployment Progress</Form.Label>
                          <ProgressBar now={progress} label={`${progress}%`} />
                        </Form.Group>
                      </Col>
                    </Row>
                  )}

                  <Button
                    className="btn-fill pull-right"
                    type="submit"
                    variant="info"
                    disabled={uploading}
                  >
                    {uploading ? "Deploying..." : "Deploy Application"}
                  </Button>
                  <div className="clearfix"></div>
                </Form>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Row>
          <Col md="8" className="mx-auto">
            <Card>
              <Card.Header>
                <Card.Title as="h5">Example Dockerfile</Card.Title>
              </Card.Header>
              <Card.Body>
                <pre className="bg-light p-3 rounded">
{`FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]`}
                </pre>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </>
  );
}

export default DeploymentUpload;