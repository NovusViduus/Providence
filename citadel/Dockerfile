FROM eclipse-temurin:21-jdk AS builder

WORKDIR /build
COPY proto/ ./proto/

WORKDIR /build/citadel
COPY citadel/pom.xml ./pom.xml
COPY citadel/src/ ./src/

RUN apt-get update && apt-get install -y maven && rm -rf /var/lib/apt/lists/*
RUN mvn package -DskipTests -B

FROM eclipse-temurin:21-jre

RUN groupadd -r citadel && useradd -r -g citadel citadel

WORKDIR /app
COPY --from=builder /build/citadel/target/*.jar app.jar

USER citadel

EXPOSE 8080 50051

ENTRYPOINT ["java", "-jar", "app.jar"]
