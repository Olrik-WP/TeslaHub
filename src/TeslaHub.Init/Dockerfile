FROM postgres:17-alpine
COPY init-db.sh /init-db.sh
RUN chmod +x /init-db.sh
ENTRYPOINT ["/init-db.sh"]
