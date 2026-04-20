package com.providence.citadel.api;

import com.providence.citadel.config.JwtAuthFilter;
import io.jsonwebtoken.Jwts;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Date;
import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private static final long EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

    private static final String ADMIN_USER = System.getenv().getOrDefault("PROVIDENCE_ADMIN_USER", "admin");
    private static final String ADMIN_PASS = System.getenv().getOrDefault("PROVIDENCE_ADMIN_PASS", "admin");
    private static final String VIEWER_USER = System.getenv().getOrDefault("PROVIDENCE_VIEWER_USER", "viewer");
    private static final String VIEWER_PASS = System.getenv().getOrDefault("PROVIDENCE_VIEWER_PASS", "viewer");

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");

        String role = null;
        if (ADMIN_USER.equals(username) && ADMIN_PASS.equals(password)) role = "admin";
        else if (VIEWER_USER.equals(username) && VIEWER_PASS.equals(password)) role = "viewer";

        if (role == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid credentials"));
        }

        Date now = new Date();
        String token = Jwts.builder()
            .subject(username)
            .claim("role", role)
            .issuedAt(now)
            .expiration(new Date(now.getTime() + EXPIRY_MS))
            .signWith(JwtAuthFilter.KEY)
            .compact();

        return ResponseEntity.ok(Map.of("token", token, "role", role, "expiresIn", EXPIRY_MS / 1000));
    }
}
