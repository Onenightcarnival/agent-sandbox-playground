import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/cosmic.css'

// StrictMode intentionally disabled: it double-invokes effects in dev, which
// would cause Pyodide to initialize twice (slow + wasteful).
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
