import React from 'react';

import Icon from '../../news-scrapper/components/Icon.jsx';

import {
  STORY_TEMPLATES,
} from './createNewsModel.js';


/**
 * Shared read-only renderer for Create News story templates.
 *
 * Used in two places:
 *
 * 1. Create News Preview
 *    mode="preview"
 *
 * 2. Published SRI-D story modal
 *    mode="published"
 *
 * The important difference is:
 *
 * PREVIEW:
 * - can show placeholder copy
 * - can show missing-image placeholders
 * - shows template / display-section metadata
 *
 * PUBLISHED:
 * - never shows authoring placeholders
 * - never shows "Cover image"
 * - never shows template implementation labels
 * - renders only the real published story content
 */
export default function CreateNewsStoryRenderer({
  layout = 'two-column',

  title = '',

  summary = '',

  templateData = {},

  coverPreview = '',

  secondaryCoverPreview = '',

  author = '',

  team = '',

  category = '',

  displaySection = '',

  mode = 'preview',
}) {
  const isPreview =
    mode === 'preview';


  const desc0 =
    templateData?.desc0 ||
    '';

  const desc1 =
    templateData?.desc1 ||
    '';


  const templateLabel =
    STORY_TEMPLATES.find(
      (template) =>
        template.id === layout,
    )?.label ||
    'Story';


  const sectionLabel =
    displaySection === 'hero'
      ? 'Hero Banner'
      : 'SRI-D News';


  /**
   * Returns real content when available.
   *
   * Placeholder text is allowed only
   * inside Create News Preview.
   */
  function previewCopy(
    value,
    placeholder,
  ) {
    if (value) {
      return value;
    }

    if (isPreview) {
      return placeholder;
    }

    return '';
  }


  /**
   * Shared image renderer.
   *
   * Published content does NOT show
   * fake missing-image placeholders.
   */
  function renderMedia(
    imageSrc,
    fallbackIcon = true,
  ) {
    if (imageSrc) {
      return (
        <img
          alt=""
          src={imageSrc}
        />
      );
    }


    if (
      isPreview &&
      fallbackIcon
    ) {
      return (
        <span>
          <Icon
            name="layers"
            size={40}
          />

          {' Cover image'}
        </span>
      );
    }


    return null;
  }


  /**
   * In preview mode:
   * show author + template metadata.
   *
   * In published mode:
   * show only real author/team information.
   */
  function renderFooter() {
    const authorText =
      author ||
      (
        isPreview
          ? 'Samsung colleague'
          : ''
      );


    const personLine = [
      authorText,
      team,
    ]
      .filter(Boolean)
      .join(' · ');


    if (
      !personLine &&
      !isPreview
    ) {
      return null;
    }


    return (
      <footer>
        {personLine && (
          <span>
            {personLine}
          </span>
        )}

        {isPreview && (
          <small>
            {templateLabel}
            {' · '}
            {sectionLabel}
          </small>
        )}
      </footer>
    );
  }


  /**
   * ============================================================
   * TWO COLUMN
   * ============================================================
   */
  function renderTwoColumn() {
    const intro =
      previewCopy(
        summary || desc0,
        'Add a short description to introduce the story.',
      );


    return (
      <>
        <header className="sampark-create-rendered-title">
          <span>
            {category ||
              (
                isPreview
                  ? 'SRI-D News'
                  : ''
              )}
          </span>

          <h2>
            {previewCopy(
              title,
              'Your news title will appear here',
            )}
          </h2>

          {intro && (
            <p>
              {intro}
            </p>
          )}
        </header>


        <div className="sampark-create-rendered-columns is-two-column">

          <div className="sampark-create-rendered-column">

            {(coverPreview ||
              isPreview) && (
              <div className="sampark-create-rendered-media">
                {renderMedia(
                  coverPreview,
                )}
              </div>
            )}

            {desc0 && (
              <p>
                {desc0}
              </p>
            )}

          </div>


          <div className="sampark-create-rendered-column">

            {(secondaryCoverPreview ||
              isPreview) && (
              <div className="sampark-create-rendered-media">
                {renderMedia(
                  secondaryCoverPreview,
                )}
              </div>
            )}

            {desc1 && (
              <p>
                {desc1}
              </p>
            )}

          </div>

        </div>


        {renderFooter()}
      </>
    );
  }


  /**
   * ============================================================
   * LIST VIEW
   * ============================================================
   */
  function renderListView() {
    const intro =
      previewCopy(
        summary,
        'Add a short description to introduce the story.',
      );


    const firstDescription =
      previewCopy(
        desc0,
        'First list item description goes here.',
      );


    const secondDescription =
      previewCopy(
        desc1,
        'Second list item description goes here.',
      );


    const showFirstItem =
      Boolean(
        coverPreview ||
        firstDescription ||
        isPreview,
      );


    const showSecondItem =
      Boolean(
        secondaryCoverPreview ||
        secondDescription ||
        isPreview,
      );


    return (
      <>
        <header className="sampark-create-rendered-title">
          <span>
            {category ||
              (
                isPreview
                  ? 'SRI-D News'
                  : ''
              )}
          </span>

          <h2>
            {previewCopy(
              title,
              'Your news title will appear here',
            )}
          </h2>

          {intro && (
            <p>
              {intro}
            </p>
          )}
        </header>


        <div className="sampark-create-rendered-list">

          {showFirstItem && (
            <div className="sampark-create-rendered-list-item">

              {(coverPreview ||
                isPreview) && (
                <div className="sampark-create-rendered-list-media">
                  {renderMedia(
                    coverPreview,
                    false,
                  )}
                </div>
              )}


              {firstDescription && (
                <div className="sampark-create-rendered-list-content">
                  <span>
                    01
                  </span>

                  <p>
                    {firstDescription}
                  </p>
                </div>
              )}

            </div>
          )}


          {showSecondItem && (
            <div className="sampark-create-rendered-list-item">

              {(secondaryCoverPreview ||
                isPreview) && (
                <div className="sampark-create-rendered-list-media">
                  {renderMedia(
                    secondaryCoverPreview,
                    false,
                  )}
                </div>
              )}


              {secondDescription && (
                <div className="sampark-create-rendered-list-content">
                  <span>
                    02
                  </span>

                  <p>
                    {secondDescription}
                  </p>
                </div>
              )}

            </div>
          )}

        </div>


        {renderFooter()}
      </>
    );
  }


  /**
   * ============================================================
   * FEATURE CARD
   * ============================================================
   */
  function renderFeatureCard() {
    const intro =
      previewCopy(
        summary,
        'Add a short description to introduce the story.',
      );


    return (
      <>
        <header className="sampark-create-rendered-title">
          <span>
            {category ||
              (
                isPreview
                  ? 'SRI-D News'
                  : ''
              )}
          </span>

          <h2>
            {previewCopy(
              title,
              'Your news title will appear here',
            )}
          </h2>

          {intro && (
            <p>
              {intro}
            </p>
          )}
        </header>


        <div className="sampark-create-rendered-feature-card">

          <div className="sampark-create-rendered-feature-main">

            {(coverPreview ||
              isPreview) && (
              <div className="sampark-create-rendered-media is-feature">
                {renderMedia(
                  coverPreview,
                )}
              </div>
            )}


            {desc0 && (
              <div className="sampark-create-rendered-feature-copy">
                <p>
                  {desc0}
                </p>
              </div>
            )}

          </div>


          {secondaryCoverPreview && (
            <div className="sampark-create-rendered-feature-side">

              <div className="sampark-create-rendered-media">
                {renderMedia(
                  secondaryCoverPreview,
                )}
              </div>

            </div>
          )}

        </div>


        {renderFooter()}
      </>
    );
  }


  /**
   * ============================================================
   * TEXT TOP
   * ============================================================
   */
  function renderTextTop() {
    const intro =
      previewCopy(
        summary || desc0,
        'Add a short description to introduce the story.',
      );


    return (
      <>
        <header className="sampark-create-rendered-title">
          <span>
            {category ||
              (
                isPreview
                  ? 'SRI-D News'
                  : ''
              )}
          </span>

          <h2>
            {previewCopy(
              title,
              'Your news title will appear here',
            )}
          </h2>

          {intro && (
            <p>
              {intro}
            </p>
          )}
        </header>


        {desc0 &&
          summary &&
          desc0 !== summary && (
            <div className="sampark-create-rendered-copy">
              <p>
                {desc0}
              </p>
            </div>
          )}


        {(coverPreview ||
          isPreview) && (
          <div className="sampark-create-rendered-media">
            {renderMedia(
              coverPreview,
            )}
          </div>
        )}


        {renderFooter()}
      </>
    );
  }


  /**
   * Unknown/legacy layout fallback.
   *
   * Old published records should still
   * remain readable rather than opening
   * an empty modal.
   */
  function renderFallback() {
    const fallbackSummary =
      summary ||
      desc0 ||
      '';


    return (
      <>
        <header className="sampark-create-rendered-title">

          {category && (
            <span>
              {category}
            </span>
          )}

          <h2>
            {title ||
              (
                isPreview
                  ? 'Your news title will appear here'
                  : 'Samsung Internal Update'
              )}
          </h2>

          {fallbackSummary && (
            <p>
              {fallbackSummary}
            </p>
          )}

        </header>


        {coverPreview && (
          <div className="sampark-create-rendered-media">
            {renderMedia(
              coverPreview,
              false,
            )}
          </div>
        )}


        {renderFooter()}
      </>
    );
  }


  return (
    <article
      className={
        `sampark-create-rendered is-${layout}${
          isPreview
            ? ' is-preview'
            : ' is-published'
        }`
      }
    >

      {layout ===
        'two-column' &&
        renderTwoColumn()}


      {layout ===
        'list-view' &&
        renderListView()}


      {layout ===
        'feature-card' &&
        renderFeatureCard()}


      {layout ===
        'text-top' &&
        renderTextTop()}


      {![
        'two-column',
        'list-view',
        'feature-card',
        'text-top',
      ].includes(layout) &&
        renderFallback()}

    </article>
  );
}
