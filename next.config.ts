import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    // !! CẢNH BÁO !!
    // Lệnh này cho phép build thành công ngay cả khi có lỗi TypeScript.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
