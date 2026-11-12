import React from 'react';

export default function DesignViewport({ children }) {
  return (
    <div className="resolution-root">
      <div
        className="resolution-canvas"
        data-layout="responsive-desktop"
      >
        {children}
      </div>
    </div>
  );
}
