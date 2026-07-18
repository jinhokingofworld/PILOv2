FROM postgres:17-alpine

ARG SOURCE_REVISION=unknown

WORKDIR /opt/pilo

COPY infra/db-migrations/run-migrations.sh /opt/pilo/run-migrations.sh
COPY infra/db-migrations/baselines /opt/pilo/baselines
COPY db/migrations /opt/pilo/migrations

RUN sed -i 's/\r$//' /opt/pilo/run-migrations.sh \
  && chmod 0555 /opt/pilo/run-migrations.sh \
  && find /opt/pilo/baselines -type f -name '*.sql' -exec chmod 0444 {} \; \
  && find /opt/pilo/migrations -type f -name '*.sql' -exec chmod 0444 {} \; \
  && printf '%s\n' "$SOURCE_REVISION" > /opt/pilo/source-revision \
  && chmod 0444 /opt/pilo/source-revision

USER postgres

ENTRYPOINT ["/opt/pilo/run-migrations.sh"]
