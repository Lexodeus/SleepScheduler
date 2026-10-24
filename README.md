# Sleep Scheduler

A Decky Loader plugin that puts the Steam Deck to sleep and wakes it up at times you pick.

- **Sleep** uses Steam's own suspend, the same as a short press of the power button. A toast shows a minute before.
- **Wake** sets the hardware wake timer (the RTC alarm), so the Deck turns back on from sleep at that time. It can't
  start a Deck that is shut down, and a flat battery stops it.
- Each event runs once, at the next time the clock shows the time you picked (today, or tomorrow if that time
  has passed). The panel lists upcoming events with the time left, and each one can be edited or cleared.
- A sleep that was missed because the Deck was already asleep or off is skipped, not run late.

The plugin needs root (the `root` flag) because only root can set the wake timer.
