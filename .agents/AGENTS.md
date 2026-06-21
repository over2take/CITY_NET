# CITY_NET Project Guidelines

## UI Modals & Alerts Styling
When building or modifying UI elements that require user confirmation, alerts, or notifications:
1. **NEVER use native browser prompts** (`window.confirm`, `window.alert`, `window.prompt`). They break the immersive cyberpunk/terminal aesthetic.
2. **Use Custom Modals**: Implement or reuse the native React `modal-overlay` system to match the app's styling.
3. **Reference Implementation**: Look at how `CRITICAL_WARNING` is implemented in `CityDataBaseMenu` or the destruction confirmation in `App.tsx`.
4. **Modal Structure Example**:
   ```tsx
   <div className="modal-overlay" style={{ zIndex: 10000 }}>
     <div className="panel critical-alert">
       <h2 className="alert-text">!! SYSTEM_ALERT !!</h2>
       <p>[MESSAGE_CONTENT]</p>
       <div className="button-group">
         <button className="upload-btn danger-btn">PROCEED</button>
         <button className="utility-btn">ABORT</button>
       </div>
     </div>
   </div>
   ```
5. **Portals**: If rendering a modal from deeply nested components (like a Sidebar menu), wrap it in `createPortal(..., document.body)` from `react-dom` to escape CSS containment constraints like `overflow: hidden` or `transform`.
