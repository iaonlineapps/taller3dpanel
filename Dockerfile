FROM node:22-slim
# Taller3D Panel: un solo archivo de Node con SQLite integrado. Sin dependencias externas.
ENV NODE_ENV=production DATA_DIR=/data PORT=8095 NODE_NO_WARNINGS=1
# Versión que se ve en la web; la imagen publicada la recibe de la etiqueta (v1.2.3)
ARG TALLER3D_VERSION=
ENV TALLER3D_VERSION=${TALLER3D_VERSION}
WORKDIR /app
COPY server.js VERSION seed.json ./
COPY public ./public
COPY entrypoint.sh /entrypoint.sh
# el contenedor corre como usuario normal: el codigo tiene que ser legible
RUN chmod -R a+rX /app && chmod 755 /entrypoint.sh && mkdir -p /data
EXPOSE 8095
HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8095)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
