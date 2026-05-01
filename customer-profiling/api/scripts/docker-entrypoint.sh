#!/bin/sh
set -e

npx prisma migrate deploy
npx prisma db push
npm run prisma:seed
node dist/src/main.js
