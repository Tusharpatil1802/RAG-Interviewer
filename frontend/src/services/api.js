import axios from 'axios';

const inferredApiUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : 'http://localhost:8000';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || inferredApiUrl,
});
