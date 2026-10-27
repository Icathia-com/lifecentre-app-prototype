# Approved design: update of 27 October 2026

These are the latest prototype screens from the Life Centre design canvas. They are the visual spec for the real app in `app/`.

## New screens

The Events tab replaces Announcements:

- `Events.dc.html`: the Events tab. It switches between two views:
  - **Upcoming**: the pinned conference, then a list grouped by day, with a location filter.
  - **Discover**: Popular this week, Browse by location, and Ministries to follow.
- `Events-Location.dc.html`: one location's page.
  - It shows the address, Directions and a Follow button.
  - Everything on at that location is grouped by type: Services, Kids, Youth, Cell groups, Prayer and Special events.
- `Event-Detail.dc.html`: the event page.
  - It has Register, Contact and More tiles. The More menu holds Add to calendar, Share link, Share poster, QR code, and Edit for staff.
  - It also shows a Location card, About, and Who's going.
- `Event-Create.dc.html`: create an event, for admins and staff. The fields are:
  - cover (colour or photo), name, start and end
  - location and description
  - Ticketing: require approval, price
  - Options: type, visibility, capacity, notify followers
  - Restore draft
- `Notifications.dc.html`: opened from the Home bell. It has an Activity list and on/off Settings. Church notices live here now.

## Updated screens

In every bottom bar, Events (ticket icon) replaces Announcements. The Home bell now opens Notifications.

## Notes

- `Announcements.dc.html` is retired, so it isn't included.
- Event content is sample data. The weekly service times come from lifecentre.sg.
