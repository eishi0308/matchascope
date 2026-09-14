/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Press video thumbnails, served from YouTube's own image CDN.
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
    ],
  },
}

module.exports = nextConfig
