# Single image, two process roles (web + worker). Pick the role at runtime:
#   web:    npm run docker-start      (default CMD)
#   worker: npm run worker
FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
# tsx is a runtime dependency because the worker executes TypeScript directly.
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npx prisma generate && npm run build

EXPOSE 3000
CMD ["npm", "run", "docker-start"]
