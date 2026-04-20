import EyeOfProvidence from './EyeOfProvidence';

/**
 * Inline QR code generator using SVG.
 * Uses a simple encoding for real QR we'd need a library,
 * so instead we link to a QR API that generates on the fly.
 */
function QRCode({ url, size = 160, label }: { url: string; size?: number; label: string }) {
  // Use a free QR code API to generate SVGs
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=0C1017&color=0A9396&format=svg`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-white rounded-lg p-2">
        <img src={qrSrc} alt={`QR code for ${label}`} width={size} height={size} className="rounded"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      </div>
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
    </div>
  );
}

export default function About() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-6">
        <EyeOfProvidence size={80} trackMouse />
        <div>
          <h1 className="text-2xl font-bold text-gray-100 tracking-wide">Graeme Huntley</h1>
          <p className="text-sm text-steel-200 tracking-wider">MS in Artificial Intelligence · Expected December 2026</p>
          <p className="text-xs text-gray-500 mt-1">Northeastern University · Seattle, WA</p>
        </div>
      </div>

      {/* Bio */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-6">
        <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-3">About</h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          Builder of Providence a multi-component network security intelligence platform spanning
          C++, Java, Python, and TypeScript across 7 integrated components. Deployed a global honeypot
          fleet across 3 AWS regions, trained ML classifiers on 2.8M network flows, and validated
          lab-trained models against live attacker traffic. Passionate about the intersection of
          security, machine learning, and real-time visualization.
        </p>
        <p className="text-sm text-gray-300 leading-relaxed mt-3">
          Currently exploring adversarial AI detection, cloud-native security architecture, and
          building tools that make complex security data accessible and actionable.
        </p>
      </div>

      {/* QR Codes */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-6">
        <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-4">Connect</h2>
        <div className="flex justify-center gap-10">
          <QRCode url="https://www.linkedin.com/in/graeme-huntley/" label="LinkedIn" />
          <QRCode url={`${window.location.origin}/Graeme_Huntley_Resume.pdf`} label="Resume" />
          <QRCode url="https://github.com/NovusViduus/Providence" label="GitHub" />
        </div>
        <div className="flex justify-center gap-6 mt-4">
          <a href="https://www.linkedin.com/in/graeme-huntley/" target="_blank" rel="noopener noreferrer"
            className="text-xs text-providence-accent-bright hover:underline">linkedin.com/in/graeme-huntley</a>
          <a href="/Graeme_Huntley_Resume.pdf" target="_blank" rel="noopener noreferrer"
            className="text-xs text-providence-accent-bright hover:underline">Download Resume (PDF)</a>
        </div>
      </div>

      {/* Next Project Age of Ash */}
      <div className="bg-providence-surface border border-providence-border rounded-lg overflow-hidden">
        <img src="/age-of-ash.png" alt="Age of Ash: Divinity Fallen" className="w-full h-72 object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div className="p-6">
          <span className="text-[10px] text-providence-accent-bright uppercase tracking-wider">Next Project</span>
          <h3 className="text-lg font-bold text-gray-100 mt-1 mb-3">Age of Ash: Divinity Fallen</h3>
          <p className="text-sm text-gray-300 leading-relaxed">
            The gods are broken. Decades ago, an apostate mortal known as the Deceiver ascended to
            godhood and waged war against the heavens. Gods were killed, scarred, driven mad and
            though the Deceiver's blasphemous crusade was shattered, the divine order has never recovered.
          </p>
          <p className="text-sm text-gray-300 leading-relaxed mt-3">
            In a river valley torn between a fracturing human kingdom and the undead civilizations that
            rose from the war's ashes, you are no one but what you become is yours to decide. Master
            dozens of deeply interconnected skills, recruit and lead diverse companions, raise undead
            laborers to work your fields or lay waste to your enemies.
          </p>
          <p className="text-sm text-gray-300 leading-relaxed mt-3">
            Participate in a brutal succession war help secure the crown for a popular princess, her
            brash brother, or champion the most unlikely of heroes, picked by a dying goddess. Build an
            empire or tend a quiet farm while the world burns around you.
          </p>
          <p className="text-sm text-gray-300 leading-relaxed mt-3">
            The gods left fragments of their power behind divine coins that contain the smallest motes
            of their souls, that can elevate those lucky enough to consume them to something more than
            mortal. The center is not holding. What rises from the ash is up to you.
          </p>
          <p className="text-base text-gray-200 font-semibold mt-4">
            Will you save the old world, or burn it away in the forges of something new?
          </p>
        </div>
      </div>

      {/* Saturn III */}
      <div className="bg-providence-surface border border-providence-border rounded-lg overflow-hidden">
        <img src="/saturn-3.png" alt="Saturn III" className="w-full h-72 object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div className="p-6">
          <span className="text-[10px] text-providence-accent-bright uppercase tracking-wider">Research Project</span>
          <h3 className="text-lg font-bold text-gray-100 mt-1 mb-3">Saturn III</h3>
          <p className="text-sm text-gray-300 leading-relaxed">
            In 1958, a team in Moscow built a computer that thought in threes. The Setun was faster,
            cheaper, and more elegant than binary. It was buried by bureaucracy, not by better engineering.
            Fifty machines. Then silence.
          </p>
          <p className="text-sm text-gray-300 leading-relaxed mt-3">
            Sixty-eight years later, binary is hitting walls it can't scale past: power, memory, design
            complexity. The industry's answer has been to bolt more cores onto the same broken paradigm.
            Saturn III asks a different question: what if the foundation was wrong?
          </p>
          <p className="text-sm text-gray-300 leading-relaxed mt-3">
            This project formalizes balanced odd-base computing as a scalable family of architectures
            where the radix is a tunable parameter, not a fixed constraint. The core result is a proof
            that any positional number system with unique, symmetric representation must use an odd
            base, making ternary the minimum viable case, not the ceiling. From there: a Dimensional
            Program Counter that replaces linear instruction pointers with geometric coordinates, a
            proof that execution in orthogonal subspaces is isolated without locks or scheduling, and
            a theory of using the center state (zero) as an active control signal rather than a passive digit.
          </p>
          <p className="text-base text-gray-200 font-semibold mt-4">
            Binary didn't win because it was better. It won because transistors were cheaper than ferrite cores. The math never cared.
          </p>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-6">
        <h2 className="text-sm text-gray-400 uppercase tracking-wider mb-3">Contact</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500 text-xs">Email</p>
            <a href="mailto:huntley.g@northeastern.edu" className="text-gray-300 font-mono hover:text-providence-accent transition-colors">
              huntley.g@northeastern.edu
            </a>
          </div>
          <div>
            <p className="text-gray-500 text-xs">LinkedIn</p>
            <a href="https://www.linkedin.com/in/graeme-huntley/" target="_blank" rel="noopener noreferrer"
              className="text-providence-accent-bright hover:underline">graeme-huntley</a>
          </div>
          <div>
            <p className="text-gray-500 text-xs">GitHub</p>
            <a href="https://github.com/NovusViduus" target="_blank" rel="noopener noreferrer"
              className="text-providence-accent-bright hover:underline">NovusViduus</a>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Location</p>
            <p className="text-gray-300">Seattle, WA</p>
          </div>
        </div>
      </div>

      <p className="text-center text-[10px] text-gray-700 tracking-wider pb-4">
        PROVIDENCE v1.0 Per Providentiam, Securitas
      </p>
    </div>
  );
}
