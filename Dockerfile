# Single image, two process roles (web + worker). Pick the role at runtime:
#   web:    npm run docker-start   (default CMD; runs prisma migrate deploy then serves)
#   worker: npm run worker
FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Full install (incl. dev deps) is required to run `react-router build` and
# `prisma generate`. NODE_ENV is set to production only for the runtime layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
