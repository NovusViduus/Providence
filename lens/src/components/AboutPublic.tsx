import About from './About';

/**
 * Standalone public About page — no auth, no sidebar.
 * Mobile users land here via the QR code on the login screen.
 */
export default function AboutPublic() {
  return (
    <div className="min-h-screen bg-providence-bg overflow-auto">
      {/* CRT effects */}
      <div className="crt-scanline" />
      <div className="crt-vignette" />

      <div className="p-4 md:p-8">
        <About />
      </div>
    </div>
  );
}
