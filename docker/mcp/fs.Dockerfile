FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
ARG SERVER_FILESYSTEM_VERSION=1.0.0
RUN npm install --global supergateway@3.4.3 @modelcontextprotocol/server-filesystem@${SERVER_FILESYSTEM_VERSION} \
 && npm cache clean --force \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs --home /home/lisptc lisptc
USER lisptc
RUN mkdir -p /home/lisptc/files
WORKDIR /home/lisptc/files
EXPOSE 8000
CMD ["supergateway", "--stdio", "mcp-server-filesystem /home/lisptc/files", "--outputTransport", "streamableHttp", "--stateful", "--port", "8000", "--streamableHttpPath", "/mcp"]
