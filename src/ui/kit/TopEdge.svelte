<script lang="ts"></script>

<!-- Keeps scrolled content out of the iPhone's translucent top edge in the
     installed app. iOS 26 finds this solid bar by hit-testing, so it must take
     taps: a pointer-events: none box is skipped and the header's top fades. -->
<div aria-hidden="true" class="hidden [@media(display-mode:standalone)]:fixed [@media(display-mode:standalone)]:inset-x-0
  [@media(display-mode:standalone)]:top-0 [@media(display-mode:standalone)]:z-1 [@media(display-mode:standalone)]:block
  [@media(display-mode:standalone)]:h-(--home-top) [@media(display-mode:standalone)]:bg-bg"></div>
