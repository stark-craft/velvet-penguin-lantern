import React, { useState } from 'react';
import SamsungInternalScreen from '../news-scrapper/screens/SamsungInternalScreen.jsx';
import ArticleModal from '../news-scrapper/components/modals/ArticleModal.jsx';

export default function SamsungNewsScreen(props) {
  const [article, setArticle] = useState(null);
  return <>
    <SamsungInternalScreen {...props} presentation="sampark" onOpenSignal={setArticle} />
    <ArticleModal item={article} onClose={() => setArticle(null)} />
  </>;
}
