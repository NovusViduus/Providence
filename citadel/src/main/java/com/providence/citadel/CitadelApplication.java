package com.providence.citadel;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CitadelApplication {
    public static void main(String[] args) {
        SpringApplication.run(CitadelApplication.class, args);
    }
}
