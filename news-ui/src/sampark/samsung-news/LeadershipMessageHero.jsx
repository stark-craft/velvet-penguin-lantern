import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
function imageScaleOf(item) {
  return Math.min(
    1.8,
    Math.max(
      0.6,
      Number(
        item?.imageScale ??
        item?.image_scale ??
        1,
      ) || 1,
    ),
  );
}
export default function LeadershipMessageHero({
  item,
  onOpen,
}) {
  if (!item) {
    return null;
  }
  const image =
    item.image_url ||
    item.top_image ||
    '';
  const author =
    item.author ||
    item.source ||
    item.src ||
    'Samsung Research Institute Delhi';
  const designation =
    item.designation ||
    item.role ||
    '';
  const summary = String(
  item.body ||
  item.summary ||
  ''
)
  .replace(/\s+/g, ' ')
  .trim();
  const imageScale =
    imageScaleOf(item);
  return (
    <article className="samsung-leadership-hero">
      {image && (
        <div className="samsung-leadership-image">
          <img
            alt=""
            src={image}
            style={{
              transform:
                `scale(${imageScale})`,
            }}
          />
        </div>
      )}
      <div className="samsung-leadership-copy">
        {/* <div className="samsung-leadership-eyebrow">
          <Icon
            name="quote"
            size={16}
          />
          <span>
            Leadership Message
          </span>
        </div> */}
        <div
          aria-hidden="true"
          className="samsung-leadership-quote"
        >
          “
        </div>
        <h2>
          {item.title ||
            'Vision from the MD'}
        </h2>
        {summary && (
          <p>
            {summary}
          </p>
        )}
        <div className="samsung-leadership-footer">
          {/* <div className="samsung-leadership-author">
            <strong>
              {author}
            </strong>
            <span>
              {designation}
            </span>
          </div> */}
          <button
            className="samsung-leadership-read"
            onClick={() =>
              onOpen?.(item)
            }
            type="button"
          >
            Read Message
            <Icon
              name="arrowRight"
              size={16}
            />
          </button>
        </div>
      </div>
    </article>
  );
}
