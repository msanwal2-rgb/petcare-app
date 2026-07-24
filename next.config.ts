import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Curated pet + caretaker photography is served from Unsplash's image CDN.
    // When a real backend lands, add its object-storage host here.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
