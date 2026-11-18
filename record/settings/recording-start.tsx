import "./recording-start.css";

export function RecordingStartPreference() {
  return (
    <fieldset className="agent-preference recording-start-preference">
      <legend className="settings-preference-label">
        When you press Record
      </legend>
      <label>
        <input
          type="radio"
          name="recording-start"
          defaultChecked
          aria-describedby="recording-start-help"
        />
        <span>Start screen recording right away</span>
      </label>
      <p id="recording-start-help">Your system may still ask what to share.</p>
      <label>
        <input
          type="radio"
          name="recording-start"
          disabled
          aria-describedby="recording-picker-help"
        />
        <span>Choose a screen each time</span>
      </label>
      <p id="recording-picker-help">Coming later.</p>
    </fieldset>
  );
}
