import path from 'path';
import cors from 'cors';
import express from 'express';
import {errorHandler} from './middleware/error-handler';
import {notFoundHandler} from './middleware/not-found';
import {requestLogger} from './middleware/request-logger';
import {healthCheck} from './routes/health';
import v1Router from './routes/v1';

const app = express();

/**
 * Cloud Run and most reverse proxies place us behind their own hop, so the
 * real client IP arrives in `X-Forwarded-For`. Trusting one hop is safe on
 * Cloud Run (and no-op when running directly). The intake endpoint uses this
 * for rate-limiting.
 */
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({limit: '2mb'}));
app.use(express.urlencoded({extended: true, limit: '2mb'}));
app.use(requestLogger);

app.get('/health', healthCheck);
app.use('/v1', v1Router);

/**
 * Public marketing site. Cloud Run hosts the API and the site behind the same
 * domain in v1; the site is fully static (HTML + CSS, no build step) and lives
 * under `public/`. The `extensions: ['html']` option lets `/docs` resolve to
 * `/docs.html` without a redirect.
 */
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(
  express.static(publicDir, {
    fallthrough: true,
    index: 'index.html',
    extensions: ['html'],
  })
);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
