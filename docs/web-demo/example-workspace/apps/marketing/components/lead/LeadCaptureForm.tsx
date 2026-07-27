export function LeadCaptureForm() {
  return (
    <form>
      <div>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" />
      </div>
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" />
      </div>
      <button type="submit">Submit</button>
    </form>
  );
}
