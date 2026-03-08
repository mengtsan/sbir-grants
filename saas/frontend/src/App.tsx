import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import OutOfCreditsModal from './components/OutOfCreditsModal';

const Home = lazy(() => import('./pages/Home'));
const Settings = lazy(() => import('./pages/Settings'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetails = lazy(() => import('./pages/ProjectDetails'));
const Login = lazy(() => import('./pages/Login'));

function RouteFallback() {
  return <div className="min-h-screen bg-slate-50" />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/app" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="settings" element={<Settings />} />
                <Route path="projects" element={<Projects />} />
                <Route path="projects/:id" element={<ProjectDetails />} />
                <Route path="*" element={<Navigate to="/app" replace />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <OutOfCreditsModal />
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
